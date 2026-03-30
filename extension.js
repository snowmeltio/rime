const vscode = require('vscode');

// Schemes that indicate a diff or non-standard context
const SKIP_SCHEMES = new Set(['git', 'review', 'gitfs', 'merge', 'conflictResolution']);

function isDiffEditor(editor) {
    const scheme = editor.document.uri.scheme;
    if (SKIP_SCHEMES.has(scheme)) return true;
    // Some tools use query params on file:// URIs for diff views
    if (scheme === 'file' && editor.document.uri.query) return true;
    return false;
}

function activate(context) {
    // Track documents already previewed this session to avoid re-triggering
    const previewed = new Set();

    // Auto-preview on tab open
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (!editor) return;

            const doc = editor.document;
            if (doc.languageId !== 'markdown') return;
            if (doc.uri.scheme !== 'file') return;
            if (isDiffEditor(editor)) return;

            const key = doc.uri.toString();
            if (previewed.has(key)) return;
            previewed.add(key);

            // Small delay to let the editor settle
            await new Promise(r => setTimeout(r, 150));

            // Verify the editor is still active
            if (vscode.window.activeTextEditor !== editor) return;

            await vscode.commands.executeCommand('markdown.showPreview', doc.uri);
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
            await vscode.commands.executeCommand('markdown.showPreview', editor.document.uri);
        })
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
