const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const vscode = require('vscode');
const {
    looksLikeMarkdown,
    hasFileExtension,
    isDiffEditor,
    isAnyPreviewTab,
    isPreviewTabFor,
    isSafeTarget,
    foreignWebviewGroup,
    shouldSkipReveal,
} = require('../extension.js');

// --- helpers -----------------------------------------------------------

function makeDoc(lines) {
    return {
        lineCount: lines.length,
        lineAt: (ln) => ({ text: lines[ln] }),
    };
}

function makeUri(p) {
    return {
        fsPath: p,
        path: p,
        scheme: 'file',
        query: '',
        toString: () => 'file://' + p,
    };
}

function makePreviewTab(basename, opts = {}) {
    const input = new vscode.TabInputWebview();
    input.viewType = 'mainThreadWebview-markdown.preview';
    return { input, label: `Preview ${basename}`, isActive: false, ...opts };
}

// Reset the shared stub's mutable state before every test in this file.
beforeEach(() => {
    vscode.window.tabGroups.all = [];
});

// --- looksLikeMarkdown ---------------------------------------------------

describe('looksLikeMarkdown', () => {
    test('is true when a heading and a list item appear (2 distinct signals)', () => {
        const doc = makeDoc(['# Heading', '- item one']);
        assert.equal(looksLikeMarkdown(doc), true);
    });

    test('is false for plain prose with no markdown patterns', () => {
        const doc = makeDoc(['This is a sentence.', 'Another sentence here.']);
        assert.equal(looksLikeMarkdown(doc), false);
    });

    test('is false when lineCount is 0', () => {
        const doc = makeDoc([]);
        assert.equal(looksLikeMarkdown(doc), false);
    });

    test('is false for two heading lines and nothing else (1 distinct pattern matched twice, not 2 distinct signals)', () => {
        const doc = makeDoc(['# Heading One', '## Heading Two']);
        assert.equal(looksLikeMarkdown(doc), false);
    });

    test('ignores signals past the first 50 lines', () => {
        const prose = Array.from({ length: 50 }, () => 'Plain prose line.');
        const doc = makeDoc([...prose, '# Heading', '- item one']);
        assert.equal(looksLikeMarkdown(doc), false);
    });
});

// --- hasFileExtension -----------------------------------------------------

describe('hasFileExtension', () => {
    test('is true when fsPath has an extension', () => {
        assert.equal(hasFileExtension({ fsPath: 'foo.md' }), true);
    });

    test('is false when fsPath has no extension', () => {
        assert.equal(hasFileExtension({ fsPath: 'foo' }), false);
    });

    test('falls back to .path when .fsPath is absent', () => {
        assert.equal(hasFileExtension({ path: 'foo.md' }), true);
    });
});

// --- isDiffEditor -----------------------------------------------------

describe('isDiffEditor', () => {
    test('is true for a git-scheme document', () => {
        const editor = { document: { uri: { scheme: 'git', query: '' } } };
        assert.equal(isDiffEditor(editor), true);
    });

    test('is true for a file-scheme document with a non-empty query', () => {
        const editor = { document: { uri: { scheme: 'file', query: 'diff=1' } } };
        assert.equal(isDiffEditor(editor), true);
    });

    test('is false for a file-scheme document with an empty query', () => {
        const editor = { document: { uri: { scheme: 'file', query: '' } } };
        assert.equal(isDiffEditor(editor), false);
    });

    for (const scheme of ['review', 'gitfs', 'merge', 'conflictResolution']) {
        test(`is true for a ${scheme}-scheme document`, () => {
            const editor = { document: { uri: { scheme, query: '' } } };
            assert.equal(isDiffEditor(editor), true);
        });
    }
});

// --- isAnyPreviewTab -----------------------------------------------------

describe('isAnyPreviewTab', () => {
    test('is true when the webview viewType contains "markdown"', () => {
        const input = new vscode.TabInputWebview();
        input.viewType = 'mainThreadWebview-markdown.preview';
        const tab = { input, label: 'Preview notes.md' };
        assert.equal(isAnyPreviewTab(tab), true);
    });

    test('is true when the label matches /preview/i even though the viewType does not mention markdown', () => {
        const input = new vscode.TabInputWebview();
        input.viewType = 'mainThreadWebview.someOtherView';
        const tab = { input, label: 'Preview notes.md' };
        assert.equal(isAnyPreviewTab(tab), true);
    });

    test('is false when neither viewType nor label indicate a preview', () => {
        const input = new vscode.TabInputWebview();
        input.viewType = 'mainThreadWebview.someOtherView';
        const tab = { input, label: 'Chat' };
        assert.equal(isAnyPreviewTab(tab), false);
    });

    test('is false for a null tab', () => {
        assert.equal(isAnyPreviewTab(null), false);
    });

    test('is false for an undefined tab', () => {
        assert.equal(isAnyPreviewTab(undefined), false);
    });

    test('is false when tab.input is a TabInputText instead of a webview', () => {
        const tab = {
            input: new vscode.TabInputText(makeUri('/proj/notes.md')),
            label: 'Preview notes.md',
        };
        assert.equal(isAnyPreviewTab(tab), false);
    });
});

// --- isPreviewTabFor -----------------------------------------------------

describe('isPreviewTabFor', () => {
    test('is true for a preview tab whose label includes the given basename', () => {
        const tab = makePreviewTab('notes.md');
        assert.equal(isPreviewTabFor(tab, 'notes.md'), true);
    });

    test('is false when the preview label belongs to a different file', () => {
        const tab = makePreviewTab('other.md');
        assert.equal(isPreviewTabFor(tab, 'notes.md'), false);
    });

    test('is false when the basename is only a substring of a different, similarly-named file', () => {
        const tab = makePreviewTab('shared-notes.md');
        assert.equal(isPreviewTabFor(tab, 'notes.md'), false);
    });
});

// --- isSafeTarget -----------------------------------------------------

describe('isSafeTarget', () => {
    test('is true for an empty group', () => {
        assert.equal(isSafeTarget({ tabs: [] }), true);
    });

    test('is true for a group containing only preview tabs', () => {
        const group = { tabs: [makePreviewTab('a.md'), makePreviewTab('b.md')] };
        assert.equal(isSafeTarget(group), true);
    });

    test('is true for a group containing only .md/.markdown source tabs', () => {
        const group = {
            tabs: [
                { input: new vscode.TabInputText(makeUri('/proj/a.md')) },
                { input: new vscode.TabInputText(makeUri('/proj/b.markdown')) },
            ],
        };
        assert.equal(isSafeTarget(group), true);
    });

    test('is false when a non-markdown source tab is present, even alongside safe tabs', () => {
        const group = {
            tabs: [
                { input: new vscode.TabInputText(makeUri('/proj/a.md')) },
                { input: new vscode.TabInputText(makeUri('/proj/app.ts')) },
            ],
        };
        assert.equal(isSafeTarget(group), false);
    });

    test('is true for a group mixing preview tabs and markdown source tabs', () => {
        const group = {
            tabs: [
                makePreviewTab('a.md'),
                { input: new vscode.TabInputText(makeUri('/proj/b.md')) },
            ],
        };
        assert.equal(isSafeTarget(group), true);
    });

    test('extension matching is case-insensitive (.MD counts as markdown)', () => {
        const group = { tabs: [{ input: new vscode.TabInputText(makeUri('/proj/a.MD')) }] };
        assert.equal(isSafeTarget(group), true);
    });
});

// --- foreignWebviewGroup -----------------------------------------------------

describe('foreignWebviewGroup', () => {
    test('returns the group hosting a non-preview webview tab', () => {
        const foreignInput = new vscode.TabInputWebview();
        foreignInput.viewType = 'mainThreadWebview.someChatView';
        const group = {
            viewColumn: 3,
            tabs: [{ input: foreignInput, label: 'Chat', isActive: true }],
        };
        vscode.window.tabGroups.all = [group];
        assert.strictEqual(foreignWebviewGroup(), group);
    });

    test('returns null when tabGroups.all is empty', () => {
        vscode.window.tabGroups.all = [];
        assert.equal(foreignWebviewGroup(), null);
    });

    test('returns null when tabGroups.all only contains preview and text tabs', () => {
        const uri = makeUri('/proj/notes.md');
        const group = {
            viewColumn: 1,
            tabs: [makePreviewTab('notes.md'), { input: new vscode.TabInputText(uri), isActive: true }],
        };
        vscode.window.tabGroups.all = [group];
        assert.equal(foreignWebviewGroup(), null);
    });

    test('with two foreign-webview groups, the leftmost (first in tabGroups.all) wins', () => {
        const makeForeign = () => {
            const input = new vscode.TabInputWebview();
            input.viewType = 'mainThreadWebview.someChatView';
            return { input, label: 'Chat', isActive: true };
        };
        const first = { viewColumn: 1, tabs: [makeForeign()] };
        const second = { viewColumn: 2, tabs: [makeForeign()] };
        vscode.window.tabGroups.all = [first, second];
        assert.strictEqual(foreignWebviewGroup(), first);
    });
});

// --- shouldSkipReveal -----------------------------------------------------

describe('shouldSkipReveal', () => {
    test('is true when the preview shares a group with the currently-active source tab (sourceActiveHere)', () => {
        const uri = makeUri('/proj/notes.md');
        const sourceInput = new vscode.TabInputText(uri);
        const group = {
            viewColumn: 1,
            activeTab: { input: sourceInput },
            tabs: [{ input: sourceInput, isActive: true }, makePreviewTab('notes.md', { isActive: false })],
        };
        vscode.window.tabGroups.all = [group];
        assert.equal(shouldSkipReveal(uri, 1), true);
    });

    test('is true when the preview tab is the active tab of a different group', () => {
        const uri = makeUri('/proj/notes.md');
        const group = {
            viewColumn: 2,
            activeTab: null,
            tabs: [makePreviewTab('notes.md', { isActive: true })],
        };
        vscode.window.tabGroups.all = [group];
        assert.equal(shouldSkipReveal(uri, 1), true);
    });

    test('is false when the only matching preview is backgrounded in a different group', () => {
        const uri = makeUri('/proj/notes.md');
        const group = {
            viewColumn: 2,
            activeTab: null,
            tabs: [makePreviewTab('notes.md', { isActive: false })],
        };
        vscode.window.tabGroups.all = [group];
        assert.equal(shouldSkipReveal(uri, 1), false);
    });

    test('is false when there is no preview tab at all', () => {
        const uri = makeUri('/proj/notes.md');
        vscode.window.tabGroups.all = [];
        assert.equal(shouldSkipReveal(uri, 1), false);
    });

    test('is false (v1.2.3 override) when a foreign webview occupies the same column as the source, even with an active preview elsewhere', () => {
        const uri = makeUri('/proj/notes.md');
        const foreignInput = new vscode.TabInputWebview();
        foreignInput.viewType = 'mainThreadWebview.someChatView';
        const chatGroup = {
            viewColumn: 1,
            activeTab: null,
            tabs: [{ input: foreignInput, label: 'Chat', isActive: true }],
        };
        const previewGroup = {
            viewColumn: 2,
            activeTab: null,
            tabs: [makePreviewTab('notes.md', { isActive: true })],
        };
        vscode.window.tabGroups.all = [chatGroup, previewGroup];
        // sourceColumn (1) matches the chat group's column -> override forces false,
        // even though (per the previous test) an active preview elsewhere would
        // otherwise cause a skip.
        assert.equal(shouldSkipReveal(uri, 1), false);
    });
});
