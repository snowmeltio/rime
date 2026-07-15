# Changelog

## 1.2.4

- Fix the preview landing on top of active code in windows with 3+ editor groups. v1.2.3's chat-routing picked "the first non-chat editor group" as the safe secondary pane with no check on what it actually held — in a layout with more than one other pane, that could be the code file you were working in, and the preview (or the source moved ahead of it) would open right over it. Target selection is now content-aware: it only lands in a group that's empty or already all markdown (`isSafeTarget`), and opens a fresh column when no existing group qualifies, rather than barging into occupied code or falling back to burying the chat again. Relocation now opens the document directly at the verified-safe column and closes the leftover chat-group tab, instead of delegating to `workbench.action.moveEditorTo{Right,Left}Group`, whose own grid-relative destination resolution could diverge from the group Rime had already checked was safe.

## 1.2.3

- Keep markdown out of the Claude Code chat pane. When you click a `.md` link inside the chat, VS Code opens the source into the chat's own editor group, and the preview followed it there — burying the chat. Rime now detects when the source has landed in the chat group (any non-preview webview editor) and moves it into the other editor group, the "secondary pane", before opening the preview, so both sit beside the chat instead of on top of it. With no chat webview open, behaviour is unchanged (the preview opens in the source's own column).

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
