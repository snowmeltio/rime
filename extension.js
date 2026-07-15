const vscode = require('vscode');
const path = require('path');

// Schemes that indicate a diff or non-standard context
const SKIP_SCHEMES = new Set(['git', 'review', 'gitfs', 'merge', 'conflictResolution']);

// Markdown signals: patterns that strongly suggest markdown content
const MD_PATTERNS = [
    /^#{1,6}\s+\S/,         // headings
    /^\s*[-*+]\s+\S/,       // unordered list items
    /^\s*\d+\.\s+\S/,       // ordered list items
    /^>\s+\S/,              // blockquotes
    /^```/,                 // fenced code blocks
    /\[.+\]\(.+\)/,         // inline links
    /\*\*.+\*\*/,           // bold text
];

const MD_SIGNAL_THRESHOLD = 2; // require at least 2 distinct signals

function looksLikeMarkdown(doc) {
    const lineCount = Math.min(doc.lineCount, 50);
    if (lineCount === 0) return false;
    const matched = new Set();
    for (let ln = 0; ln < lineCount; ln++) {
        const text = doc.lineAt(ln).text;
        for (let i = 0; i < MD_PATTERNS.length; i++) {
            if (!matched.has(i) && MD_PATTERNS[i].test(text)) {
                matched.add(i);
                if (matched.size >= MD_SIGNAL_THRESHOLD) return true;
            }
        }
    }
    return false;
}

function hasFileExtension(uri) {
    const ext = path.extname(uri.fsPath || uri.path);
    return ext.length > 0;
}

function isDiffEditor(editor) {
    const scheme = editor.document.uri.scheme;
    if (SKIP_SCHEMES.has(scheme)) return true;
    // Some tools use query params on file:// URIs for diff views
    if (scheme === 'file' && editor.document.uri.query) return true;
    return false;
}

// True when `tab` is a built-in markdown preview webview (for any file). The
// preview is surfaced through the Tab API as a webview whose viewType is
// "mainThreadWebview-markdown.preview" and whose label is "Preview <filename>".
function isAnyPreviewTab(tab) {
    if (!tab || !(tab.input instanceof vscode.TabInputWebview)) return false;
    const label = tab.label || '';
    return (tab.input.viewType || '').includes('markdown') || /preview/i.test(label);
}

// True when `tab` is the markdown preview for the file `basename` specifically,
// so another file's preview is never mistaken for this one. A plain substring
// test on the label (`Preview <filename>`) previously matched too eagerly --
// e.g. basename "notes.md" matched a label for "shared-notes.md" -- so this
// requires basename to appear at a word/path boundary (preceded by start-of-
// string or whitespace) rather than mid-filename.
function isPreviewTabFor(tab, basename) {
    if (!isAnyPreviewTab(tab)) return false;
    const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}$`).test(tab.label || '');
}

// True when every tab in `group` is markdown-related -- a preview (for any
// file) or another markdown source -- or the group is empty. Safe to
// relocate the source+preview into without burying someone else's real
// content, e.g. the user's active code file. This is the check v1.2.3's
// group selection was missing (it took "the first non-chat group"
// unconditionally, whatever that group held), which is what let a preview
// land on top of active code. Checking *every* tab, not just the active one,
// also leaves alone a group with a backgrounded code tab even though nothing
// of it is visible right now. Deliberately not scoped to *this* file's own
// preview: any established markdown pane (this file's or another's) is fair
// game to reuse, otherwise a second, different markdown file opened from the
// chat would find its own prior pane "unsafe" (it holds this file's source
// tab, not a preview tab) and have nowhere safe to go.
function isSafeTarget(group) {
    return group.tabs.every(tab =>
        isAnyPreviewTab(tab) ||
        (tab.input instanceof vscode.TabInputText &&
            ['.md', '.markdown'].includes(
                path.extname(tab.input.uri.fsPath || tab.input.uri.path).toLowerCase())));
}

// The editor group hosting a non-preview webview — in practice the Claude Code
// chat (or any other webview-based editor). We match "a webview that isn't a
// markdown preview" rather than the chat's specific viewType, so this keeps
// working if Anthropic ever renames that view. Groups iterate left-to-right, so
// the leftmost such group wins, matching the common chat-on-the-left layout.
// Returns null when no foreign webview is open (e.g. the chat is closed), in
// which case markdown routing falls back to wherever the source already is.
function foreignWebviewGroup() {
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputWebview && !isAnyPreviewTab(tab)) {
                return group;
            }
        }
    }
    return null;
}

// Decide whether to suppress the auto-reveal for a just-activated markdown
// source editor. We skip only when foregrounding the preview would steal focus
// the user plainly didn't want:
//   - the preview shares a group with the source they just activated: a
//     single-pane tab flip TO the source (they chose the source), or
//   - the preview is the active (visible) tab of another group: already on
//     screen beside the source.
// We do NOT skip when the only preview is backgrounded in a DIFFERENT group:
// foregrounding it there usefully brings it back alongside (the v1.2.0
// re-click behaviour). With no preview open we also don't skip, so the first
// activation opens one. This holds even if the Tab API reports the pre-click
// active tab: in the same-pane case the preview is then still `isActive`, so
// the second clause catches what the first would have.
//
// One override (v1.2.3): never skip when the source itself sits in the chat's
// editor group. VS Code routes .md links clicked in the chat into that group,
// and we always want to evacuate the source out of it — even if its preview is
// already visible in the secondary pane (where showPreviewInSecondaryPane will
// reveal it after the move).
function shouldSkipReveal(uri, sourceColumn) {
    const chat = foreignWebviewGroup();
    if (chat && chat.viewColumn === sourceColumn) return false;
    const key = uri.toString();
    const basename = path.basename(uri.fsPath || uri.path);
    for (const group of vscode.window.tabGroups.all) {
        const sourceActiveHere =
            group.activeTab &&
            group.activeTab.input instanceof vscode.TabInputText &&
            group.activeTab.input.uri.toString() === key;
        for (const tab of group.tabs) {
            if (isPreviewTabFor(tab, basename) && (sourceActiveHere || tab.isActive)) {
                return true;
            }
        }
    }
    return false;
}

function activate(context) {
    // Track documents already checked for markdown sniffing to avoid re-checking
    const sniffed = new Set();
    // URI of the reveal currently in flight. Swallows ONLY the
    // onDidChangeActiveTextEditor that our own showTextDocument re-fires for the
    // same file; activations for any other file fall through and supersede it.
    let revealingKey = null;
    // Pending "clear revealingKey" timers, keyed by URI, so a rapid re-reveal of
    // the same file cancels the prior reveal's trailing clear instead of letting
    // it null revealingKey while the re-reveal is mid-flight.
    const clearTimers = new Map();
    // Per-file settle timers: a burst of activations on one file collapses into
    // one reveal, and switching files leaves the stale reveal to bail.
    const settleTimers = new Map();

    // Keep the preview in sync when the underlying file changes on disk. VS
    // Code's built-in preview is meant to live-update, but it's unreliable when
    // a file is overwritten externally (microsoft/vscode#13280, #265277) — e.g.
    // a tool rewriting the .md you're reading. We watch ONLY the file currently
    // in the preview — any extension, including sniffed extensionless files — so
    // unrelated writes elsewhere never flicker it. markdown.preview.refresh takes
    // no URI and refreshes the visible preview, which is fine here because the
    // watched file is the one on screen.
    let previewWatcher = null;
    let watchedKey = null;
    let refreshTimer = null;
    const watchPreviewFile = (uri) => {
        if (uri.scheme !== 'file') return; // disk-watching only applies to files
        const key = uri.toString();
        if (key === watchedKey) return; // already watching this file
        if (previewWatcher) previewWatcher.dispose();
        clearTimeout(refreshTimer); // drop any pending refresh for the old file
        watchedKey = key;
        // Watch the containing directory and match the exact file by URI in the
        // handler, rather than using the basename as a RelativePattern glob:
        // filenames with glob metacharacters ([ ] * ? { }) would otherwise be
        // misread — never matching, or over-matching siblings.
        previewWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), '*')
        );
        const refresh = (changed) => {
            if (changed.toString() !== key) return; // ignore sibling files
            clearTimeout(refreshTimer);
            // Debounce: collapse a burst of writes (e.g. streamed output) into
            // one refresh, and give VS Code time to reload the document model
            // from disk first so the refresh renders fresh text.
            refreshTimer = setTimeout(() => {
                // Skip while the buffer is dirty: the preview renders the unsaved
                // in-memory model, not disk, so a refresh would show stale text
                // and mask the conflict.
                const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === key);
                if (doc && doc.isDirty) return;
                vscode.commands.executeCommand('markdown.preview.refresh');
            }, 250);
        };
        previewWatcher.onDidChange(refresh);
        previewWatcher.onDidCreate(refresh);
    };
    context.subscriptions.push({
        dispose: () => {
            if (previewWatcher) previewWatcher.dispose();
            clearTimeout(refreshTimer);
        }
    });

    // Foreground the markdown preview, keeping both the source and the preview
    // out of the chat's editor group. When you click a .md link inside the chat,
    // VS Code routes the source into the chat group (the active group); left
    // alone, markdown.showPreview then opens the preview there too, burying the
    // chat. So when the source has landed in the chat group, we relocate it to
    // another editor group first, then preview beside it.
    //
    // Target selection only ever considers groups that are safe to land in:
    // empty, or already all markdown content (isSafeTarget) — never a group
    // that's showing someone's real, visible code. When no existing group
    // qualifies, we open a brand-new column instead of falling back to "the
    // first non-chat group" (the v1.2.3 bug) or leaving the source stuck in
    // the chat group (a silent regression to the pre-v1.2.3 bug, and exactly
    // the common two-pane chat+code case from the bug report, where the only
    // other group is always the code group). VS Code creates editor groups on
    // demand up to the requested column (columnToEditorGroup in VS Code's own
    // source), so targeting one past the highest existing column always
    // yields a fresh, empty group — never an occupied one.
    //
    // The relocation itself opens the document directly in the target group's
    // exact viewColumn and closes the leftover tab in the chat group, rather
    // than delegating to workbench.action.moveEditorTo{Right,Left}Group. Those
    // commands re-resolve their own destination via VS Code's live grid
    // geometry relative to the source group — independent of the target we
    // just verified is safe — and, when moving into an *existing* adjacent
    // group, join whatever is already there rather than creating a new one.
    // In any layout with 3+ groups or vertical splits that resolution can
    // diverge from our target entirely, which is how a verified-safe decision
    // could still end up landing on top of real code.
    //
    // With no chat webview open, foreignWebviewGroup() is null and we just
    // preview in the source's own column (the prior behaviour). Returns the
    // column the markdown now occupies, for the caller's focus handling.
    async function showPreviewInSecondaryPane(document, sourceColumn) {
        const chat = foreignWebviewGroup();
        const needsEvacuation = !!(chat && chat.viewColumn === sourceColumn);
        let target = needsEvacuation
            ? vscode.window.tabGroups.all.find(g => g.viewColumn !== chat.viewColumn && isSafeTarget(g))
            : null;
        if (needsEvacuation && !target) {
            const maxColumn = Math.max(...vscode.window.tabGroups.all.map(g => g.viewColumn));
            target = { viewColumn: maxColumn + 1 };
        }
        // Captured before we touch anything, so we can evacuate the chat group
        // afterwards: showTextDocument into a different column opens a new tab
        // there, it doesn't move the existing one, so the old tab needs an
        // explicit close.
        const sourceTab = target && chat.tabs.find(t =>
            t.input instanceof vscode.TabInputText &&
            t.input.uri.toString() === document.uri.toString());

        // Focus the source so the relocation/preview act on it, not whichever
        // webview/panel currently holds focus.
        await vscode.window.showTextDocument(document, sourceColumn, false);
        if (target) {
            await vscode.window.showTextDocument(document, target.viewColumn, false);
            if (sourceTab) await vscode.window.tabGroups.close(sourceTab);
        }

        await vscode.commands.executeCommand('markdown.showPreview', document.uri);
        watchPreviewFile(document.uri);
        return target ? target.viewColumn : sourceColumn;
    }

    // Foreground the preview for a freshly activated markdown editor. Runs on
    // every activation (not once per session), so re-clicking a markdown file
    // always brings its preview to the front — treating the click as a
    // deliberate "show me this" action.
    async function revealPreview(key) {
        // Re-resolve the editor: the one captured before the settle delay may
        // have closed, moved column, or been superseded. Using the live one
        // avoids opening the preview against stale viewColumn state.
        const live = vscode.window.visibleTextEditors.find(
            e => e.document.uri.toString() === key
        );
        if (!live) return;

        // Only foreground when this markdown file is genuinely the active text
        // editor. If focus has moved elsewhere during the settle delay — to a
        // different document, or a non-text surface like the agent chat webview
        // or terminal (activeTextEditor undefined) — leave focus where it is
        // rather than yanking it back. This is the v1.1.2/v1.1.3 hijack guard.
        const active = vscode.window.activeTextEditor;
        if (!active || active.document.uri.toString() !== key) return;

        // Where focus lands after the preview foregrounds: 'preview' (focus the
        // preview, default), 'source' (return focus to the editor), 'preserve'
        // (bounce focus back toward where it came from, e.g. an agent chat).
        const behaviour = vscode.workspace
            .getConfiguration('rime')
            .get('focusBehaviour', 'preview');

        // A re-reveal of this file supersedes the prior reveal's trailing clear,
        // so it can't null revealingKey while we're mid-flight.
        clearTimeout(clearTimers.get(key));
        clearTimers.delete(key);
        revealingKey = key;
        try {
            // Foreground the preview in the secondary pane (never the chat
            // group). Returns the column the markdown now occupies, which may
            // differ from live.viewColumn if the source was moved out of the
            // chat group.
            const column = await showPreviewInSecondaryPane(live.document, live.viewColumn);

            // markdown.showPreview has no preserveFocus option — it always pulls
            // focus into the preview webview. Hand focus back per the setting so
            // the preview foregrounds without trapping the user in it.
            if (behaviour === 'source') {
                // Reliable: return focus to the source editor in its column.
                await vscode.window.showTextDocument(live.document, column, false);
            } else if (behaviour === 'preserve') {
                // Best-effort: bounce focus back toward the group it came from
                // (e.g. an agent chat in an adjacent editor column). VS Code has
                // no API to refocus an arbitrary webview/panel, so this only
                // returns to the chat if it occupies an editor group.
                await vscode.commands.executeCommand('workbench.action.focusPreviousGroup');
            }
        } finally {
            // Clear on a trailing tick, not synchronously: the activation event
            // our showTextDocument triggers is delivered asynchronously, often
            // after this block resolves. Clearing late keeps that self-induced
            // same-key event swallowed by the guard in the listener. Tracked in
            // clearTimers so a rapid re-reveal of this file can cancel it.
            clearTimers.set(key, setTimeout(() => {
                clearTimers.delete(key);
                if (revealingKey === key) revealingKey = null;
            }, 50));
        }
    }

    // Auto-preview / foreground on tab activation
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (!editor) return;
            // Swallow only the activation our own reveal re-fires for the same
            // file; genuine switches to other files fall through.
            if (revealingKey && editor.document.uri.toString() === revealingKey) return;

            const doc = editor.document;
            if (isDiffEditor(editor)) return;

            // Sniff extensionless plaintext files for markdown content
            if (doc.languageId === 'plaintext' && !hasFileExtension(doc.uri)) {
                const sniffKey = doc.uri.toString();
                if (!sniffed.has(sniffKey) && looksLikeMarkdown(doc)) {
                    sniffed.add(sniffKey);
                    // setTextDocumentLanguage re-fires the editor change event,
                    // so the preview logic runs on the re-fired (markdown) event.
                    vscode.languages.setTextDocumentLanguage(doc, 'markdown');
                    return;
                }
                sniffed.add(sniffKey);
            }

            if (doc.languageId !== 'markdown') return;
            if (SKIP_SCHEMES.has(doc.uri.scheme)) return;

            const key = doc.uri.toString();

            // Suppress the reveal when foregrounding the preview would only
            // steal focus the user didn't want: they flipped to the source tab
            // in a shared pane, or the preview is already visible beside it.
            // See shouldSkipReveal for the full rule. The manual command
            // (Cmd+Shift+M) is unaffected and still foregrounds on demand.
            if (shouldSkipReveal(doc.uri, editor.viewColumn)) {
                // Cancel any reveal still pending for this file so a stale
                // settle timer can't fire after we've decided it's already up.
                clearTimeout(settleTimers.get(key));
                settleTimers.delete(key);
                return;
            }

            // Settle delay before revealing, debounced per file: a burst of
            // activations on one file collapses to a single reveal, and
            // switching to another file leaves the stale reveal to bail (its
            // active-editor check will no longer match).
            clearTimeout(settleTimers.get(key));
            settleTimers.set(key, setTimeout(() => {
                settleTimers.delete(key);
                revealPreview(key);
            }, 150));
        })
    );

    // Manual command
    context.subscriptions.push(
        vscode.commands.registerCommand('rime.openPreview', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('Open a markdown file first.');
                return;
            }
            if (editor.document.languageId !== 'markdown') {
                vscode.window.showWarningMessage('Active file is not a markdown file.');
                return;
            }
            if (editor.document.uri.scheme !== 'file') {
                vscode.window.showWarningMessage('Markdown preview is not supported for remote files.');
                return;
            }
            await showPreviewInSecondaryPane(editor.document, editor.viewColumn);
        })
    );
}

function deactivate() {}

// Everything past deactivate is exported only for test/extension.test.js —
// VS Code's extension host only ever calls activate/deactivate.
module.exports = {
    activate,
    deactivate,
    looksLikeMarkdown,
    hasFileExtension,
    isDiffEditor,
    isAnyPreviewTab,
    isPreviewTabFor,
    isSafeTarget,
    foreignWebviewGroup,
    shouldSkipReveal,
};
