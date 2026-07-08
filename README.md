# Markdown Preview Tool

A VS Code extension that provides an enhanced Markdown preview with a navigable table of contents, three-way sync, zoom, theme switching, and more.

## Features

- **Table of Contents** — Auto-generated collapsible tree sidebar from headings, with scroll spy highlighting
- **Resizable TOC** — Drag the sidebar edge to adjust width
- **Three-way Sync** — TOC, Preview, and Markdown editor stay in sync:
  - Click a TOC item → Preview scrolls + Editor jumps to the heading
  - Scroll Preview → TOC highlights + Editor follows
  - Move cursor in Editor → Preview and TOC follow
- **Theme Switching** — Defaults to Light theme; cycle through Light → Dark → System (follows VS Code)
- **Zoom** — `Ctrl/Cmd + Scroll` or toolbar `+`/`-` buttons to zoom in/out (50%–200%)
- **Copy** — Hover over code blocks for a copy icon; toolbar button to copy full Markdown source
- **Scroll Quick Nav** — Floating bubble buttons in the bottom-right to jump to top/bottom
- **Refresh** — Toolbar refresh button to manually sync preview with latest Markdown content

## Usage

| Action | Shortcut / Command |
|--------|-------------------|
| Open Preview | `Ctrl+Shift+V` / `Cmd+Shift+V` |
| Open Preview to Side | Command: `Open Markdown Preview to the Side` |
| Toggle TOC | Toolbar `☰` button |
| Collapse TOC items | Click ▼/▶ toggle arrows |
| Resize TOC | Drag left edge of the sidebar |
| Zoom in/out | `Ctrl/Cmd + Scroll` or toolbar `+`/`-` buttons |
| Switch theme | Toolbar theme button (Light / Dark / System) |
| Copy code block | Hover over code block, click copy icon |
| Copy Markdown source | Toolbar copy button |
| Refresh preview | Toolbar refresh `🔄` button |

## Requirements

- VS Code `^1.125.0`

## Release Notes

### 0.0.4

Three-way sync, collapsible TOC tree, resizable sidebar, default Light theme.
