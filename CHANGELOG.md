# Changelog

## 1.2.2

- Don't pull focus back to the preview when you switch to the markdown source to edit it. The preview still foregrounds when you open or activate a markdown file, but if its preview is already visible beside the editor — or stacked as a tab in the same pane — clicking into the source now leaves focus there. A preview that's been closed or backgrounded in another group is still brought forward, and `Cmd+Shift+M` foregrounds on demand.

## 1.2.1

- Harden the re-entrancy clear: the `revealingKey` guard now clears on a tracked trailing timer that a rapid re-reveal can cancel, so it can't null the key mid-reveal. Scope the disk-change refresh watcher to the file currently in the preview, so unrelated writes never flicker it.

## 1.2.0

- Foreground the preview on every markdown activation (not just once per session), so re-opening a file always brings its preview forward.
- Refresh the preview when the underlying file changes on disk, working around VS Code's unreliable refresh on external overwrite.
- New `rime.focusBehaviour` setting (`preview` / `source` / `preserve`) controlling where focus lands after the preview opens.

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
