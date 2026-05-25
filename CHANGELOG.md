# Changelog

## 1.1.3

- Fix flaky auto-preview introduced in 1.1.2. The unconditional `showTextDocument` refocus call was stealing focus back to the markdown source even when the user had navigated away during the 150 ms settle delay, and it operated on a possibly-stale `viewColumn` captured before the delay. The refocus now (a) re-resolves the live editor by URI, (b) bails if the active editor has moved to a different document, and (c) uses the live `viewColumn`. The Claude-Code-panel hijacking fix from 1.1.2 is preserved.

## 1.1.2

- Refocus source editor before opening preview, so the preview lands in the source column instead of whichever webview (e.g. Claude Code) currently holds focus.

## 1.0.0

- Auto-opens markdown preview when a markdown file is opened.
- Bundled reading stylesheet: serif body, sans-serif headings, clean tables, dark mode support.
- Smart skip: no preview for git diffs, PR reviews, merge conflicts.
- Session tracking: each file previewed once per session.
- Manual command: `Cmd+Shift+M` / `Ctrl+Shift+M`.
