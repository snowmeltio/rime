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

function activate(context) {
    // Track documents already checked for markdown sniffing to avoid re-checking
    const sniffed = new Set();
    // URI of the reveal currently in flight. Swallows ONLY the
    // onDidChangeActiveTextEditor that our own showTextDocument re-fires for the
    // same file; activations for any other file fall through and supersede it.
    let revealingKey = null;
    // URI backing the preview Rime last foregrounded. The disk-change watcher
    // refreshes only this file, so unrelated *.md writes (e.g. agent scratch or
    // state files) don't flicker whatever you're reading.
    let lastPreviewKey = null;
    // Per-file settle timers: a burst of activations on one file collapses into
    // one reveal, and switching files leaves the stale reveal to bail.
    const settleTimers = new Map();

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

        revealingKey = key;
        try {
            // Refocus the source editor so the preview opens in its column,
            // not whichever webview/panel happens to hold focus right now.
            await vscode.window.showTextDocument(live.document, live.viewColumn, false);
            await vscode.commands.executeCommand('markdown.showPreview', live.document.uri);
            lastPreviewKey = key;

            // markdown.showPreview has no preserveFocus option — it always pulls
            // focus into the preview webview. Hand focus back per the setting so
            // the preview foregrounds without trapping the user in it.
            if (behaviour === 'source') {
                // Reliable: return focus to the source editor.
                await vscode.window.showTextDocument(live.document, live.viewColumn, false);
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
            // same-key event swallowed by the guard in the listener.
            setTimeout(() => { if (revealingKey === key) revealingKey = null; }, 50);
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

    // Keep the preview in sync when the underlying file changes on disk. VS
    // Code's built-in preview is meant to live-update, but it's unreliable when
    // a file is overwritten externally (microsoft/vscode#13280, #265277) — e.g.
    // a tool rewriting the .md you're reading. markdown.preview.refresh takes no
    // URI (it refreshes the visible preview), so we only fire it for the file we
    // last previewed, and skip it while the buffer is dirty (the preview renders
    // the unsaved in-memory model, not disk, so refreshing would show stale text
    // and mask the conflict).
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
    const refreshTimers = new Map();
    const scheduleRefresh = (uri) => {
        const k = uri.toString();
        if (k !== lastPreviewKey) return;
        clearTimeout(refreshTimers.get(k));
        // Debounce: collapse a burst of writes (e.g. streamed output) into one
        // refresh, and give VS Code time to reload the document model from disk
        // first so the refresh renders fresh text.
        refreshTimers.set(k, setTimeout(() => {
            refreshTimers.delete(k);
            const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === k);
            if (doc && doc.isDirty) return;
            vscode.commands.executeCommand('markdown.preview.refresh');
        }, 250));
    };
    watcher.onDidChange(scheduleRefresh);
    watcher.onDidCreate(scheduleRefresh);
    context.subscriptions.push(watcher);

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
            await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
            await vscode.commands.executeCommand('markdown.showPreview', editor.document.uri);
            lastPreviewKey = editor.document.uri.toString();
        })
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
