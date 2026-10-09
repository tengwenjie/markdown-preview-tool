# Markdown Preview Tool

A VS Code extension that provides an enhanced Markdown preview with a navigable table of contents, three-way sync, context-menu actions, zoom, theme switching, interactive Mermaid diagrams, and code copy helpers.

## Features

- **Table of Contents** — Auto-generated collapsible tree sidebar from headings, with scroll spy highlighting
- **Resizable / Hideable TOC** — Drag the sidebar edge to adjust width, or hide it completely from the right-click menu
- **Three-way Sync** — TOC, Preview, and Markdown editor stay in sync:
  - Click a TOC item → Preview scrolls + Editor jumps to the heading
  - Scroll Preview → TOC highlights + Editor follows
  - Move cursor in Editor → Preview and TOC follow
- **Theme Switching** — Defaults to Light theme; cycle through Light → Dark → System (follows VS Code)
- **Zoom** — `Ctrl/Cmd + Scroll` zooms the full preview, including code blocks (50%–200%); right-click menu can reset to 100%
- **Context Menu** — Right-click the preview to refresh, toggle TOC, reset zoom, switch theme, or copy Markdown source
- **Copy** — Hover over code blocks for a copy icon; right-click a code block to copy it immediately
- **Mermaid Diagrams** — Render `mermaid` fenced code blocks as interactive diagrams, each with:
  - **Drag to pan** — Hold the left mouse button and drag (the cursor turns into a hand) to reposition the diagram
  - **Per-diagram zoom** — `Ctrl/Cmd + Scroll` over a diagram zooms only that diagram (10%–300%), leaving the rest of the page untouched
  - **Dedicated right-click menu** — Reset zoom, Copy Mermaid code, Copy PNG (rendered to the clipboard as an image), Show graph, and Show source
- **Links** — Clicking a link works: `#heading` anchors scroll the preview (and the editor follows), links to other files open in the editor beside the preview (`other.md#heading` also jumps to that heading), non-text files open with their default VS Code editor, and `http(s)` / `mailto:` links open outside VS Code
- **Images** — Local images display in the preview, whether written as a relative path (`./img/a.png`, `../assets/a.png`), an absolute path, a `file://` URI, a remote URL, a `data:` URI, or a raw `<img>` tag
- **Image Menu** — Right-click an image for `Copy image` (copy the image to the clipboard as PNG) or `Save image` (choose a location and save the original image file).
- **Code Styling** — Code blocks use dark green base text and gray italic comments
- **Scroll Quick Nav** — Floating bubble buttons in the bottom-right to jump to top/bottom
- **Refresh** — Right-click menu refresh action manually syncs preview with latest Markdown content

## Usage

| Action | Shortcut / Command |
|--------|-------------------|
| Open Preview | `Ctrl+Shift+V` / `Cmd+Shift+V` |
| Open Preview to Side | Command: `Open Markdown Preview to the Side` |
| Open preview menu | Right-click inside the preview |
| Copy or save an image | Right-click an image: `Copy image` / `Save image` |
| Toggle TOC | Floating button at the top-right of the content area, or preview right-click menu: `Toggle contents` |
| Collapse TOC items | Click ▼/▶ toggle arrows |
| Resize TOC | Drag left edge of the sidebar |
| Zoom in/out | `Ctrl/Cmd + Scroll` |
| Reset zoom | Preview right-click menu: `Zoom 100%` |
| Switch theme | Preview right-click menu: `Switch theme` |
| Follow a link | Click it in the preview |
| Copy code block | Right-click a code block, or hover and click the copy icon |
| Copy Markdown source | Preview right-click menu: `Copy Markdown source` |
| Refresh preview | Preview right-click menu: `Refresh preview` |
| Pan a Mermaid diagram | Hold the left mouse button over the diagram and drag |
| Zoom a Mermaid diagram | `Ctrl/Cmd + Scroll` over the diagram (10%–300%) |
| Mermaid diagram menu | Right-click a diagram: `Reset zoom`, `Copy mermaid code`, `Copy PNG`, `Show graph`, `Show source` |

## Requirements

- VS Code `^1.125.0`

## Release Notes

### 0.1.0

Fixed local images not rendering. Image sources are now rewritten to webview URIs and the referenced folders are added to the preview's allowed resource roots, so relative, absolute, and `file://` paths all display — in Markdown image syntax and raw `<img>` tags alike.

Links in the preview are now clickable: in-page `#heading` anchors, links to other files (opened in the editor, with `#heading` jumps), and external `http(s)` / `mailto:` links. `Copy Markdown source` now copies the document verbatim instead of an escaped string.

### 0.0.11

Reworked Mermaid diagrams into interactive views: drag to pan (hand cursor), `Ctrl/Cmd + Scroll` to zoom a single diagram (10%–300%) without affecting the page, and a dedicated right-click menu (Reset zoom, Copy Mermaid code, Copy PNG, Show graph, Show source). Removed the per-diagram toolbar. Mermaid now renders labels as SVG text so diagrams can be copied to the clipboard as PNG.

### 0.0.7

Removed the top toolbar and moved preview actions into a right-click menu. Code blocks now scale with preview zoom, support right-click copy, and use dark green base text with gray italic comments. TOC hiding now removes the sidebar from layout and uses tighter right spacing.

### 0.0.4

Three-way sync, collapsible TOC tree, resizable sidebar, default Light theme.
