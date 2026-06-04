# Rime

**Auto-preview for markdown in VS Code.**

Rime opens VS Code's built-in markdown preview whenever you open a `.md` file, and bundles a reading-optimised stylesheet. No clicks, no configuration. Designed for markdown-heavy workspaces — consulting deliverables, meeting notes, project documentation — where you almost always want to see the rendered version.

![Light mode](https://raw.githubusercontent.com/snowmeltio/rime/main/media/screenshot-light.png) ![Dark mode](https://raw.githubusercontent.com/snowmeltio/rime/main/media/screenshot-dark.png)

## Features

- **Auto-preview** — open a `.md` file, get the rendered preview immediately.
- **Reading stylesheet** — serif body text, sans-serif headings, proper tables, dark mode support. Designed for documents, not READMEs.
- **Smart skip** — won't trigger in git diffs, PR reviews, or merge conflicts.
- **Edit-friendly** — the preview comes forward when you open or switch to a markdown file, but won't grab focus back when you click into the source to edit, whether the preview sits beside the editor or stacked in the same pane.
- **Manual command** — `Cmd+Shift+M` (Mac) / `Ctrl+Shift+M` (Windows/Linux) to open preview on demand.
- **Configurable focus** — set `rime.focusBehaviour` to choose where focus lands after the preview opens: `preview` (default), `source`, or `preserve`.

## Requirements

- VS Code 1.77 or later

## Licence

[PolyForm Shield 1.0.0](LICENSE.md)

Use it freely. Fork it, extend it, run it at work. The one restriction: don't sell it or use it to build a competing product.

If you'd like to use Rime beyond the scope of the licence, get in touch at [murray@snowmelt.io](mailto:murray@snowmelt.io).

Copyright 2026 Snowmelt Consulting Pty Ltd.
