# Glimpse

Auto-opens VS Code's markdown preview when you open a markdown file. Includes a clean reading stylesheet so your documents look like documents, not source code.

## Features

- **Auto-preview** — open a `.md` file, get the rendered preview. No extra clicks.
- **Reading stylesheet** — serif body text, sans-serif headings, proper tables, dark mode. Designed for documents, not READMEs.
- **Smart skip** — won't trigger in git diffs, PR reviews, or merge conflicts.
- **Session aware** — each file is previewed once per session. Switching back won't re-trigger.
- **Manual command** — `Cmd+Shift+M` (Mac) / `Ctrl+Shift+M` (Windows/Linux) if you need it.

## Install

Install from the VS Code Marketplace, or from a `.vsix` file:

```
code --install-extension glimpse-1.0.0.vsix
```

## Why

If you work in markdown-heavy workspaces — consulting deliverables, meeting notes, project documentation — you almost always want to see the rendered version. Glimpse just does it.

## License

MIT
