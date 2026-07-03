import * as vscode from 'vscode';
import MarkdownIt = require('markdown-it');

interface TOCItem {
    level: number;
    text: string;
    id: string;
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-');
}

export class MarkdownPreviewPanel {
    public static readonly viewType = 'markdownPreview';
    public static currentPanel: MarkdownPreviewPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private currentFile: string = '';
    private rawMarkdown: string = '';
    private readonly md: MarkdownIt;

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        MarkdownPreviewPanel.currentPanel = new MarkdownPreviewPanel(panel, extensionUri);
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        column?: vscode.ViewColumn
    ) {
        const activeColumn = column || vscode.ViewColumn.Two;

        if (MarkdownPreviewPanel.currentPanel) {
            MarkdownPreviewPanel.currentPanel.panel.reveal(activeColumn);
            MarkdownPreviewPanel.currentPanel.updateFromActiveEditor();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            MarkdownPreviewPanel.viewType,
            'Markdown Preview',
            activeColumn,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            }
        );

        MarkdownPreviewPanel.currentPanel = new MarkdownPreviewPanel(
            panel,
            extensionUri
        );
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.md = this.createMarkdownIt();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.onDidChangeViewState(
            () => {
                if (this.panel.visible) {
                    this.updateFromActiveEditor();
                }
            },
            null,
            this.disposables
        );

        this.panel.webview.onDidReceiveMessage(
            (message) => {
                if (message.command === 'copy') {
                    vscode.env.clipboard.writeText(message.text);
                }
            },
            null,
            this.disposables
        );

        this.updateFromActiveEditor();
    }

    public update(markdown: string, filePath?: string) {
        this.rawMarkdown = markdown;
        this.currentFile = filePath || this.currentFile;

        const tocItems = this.extractTOC(markdown);
        const html = this.md.render(markdown);
        const filename = this.currentFile
            ? this.currentFile.replace(/^.*[\\/]/, '')
            : 'untitled.md';

        this.panel.title = filename;
        this.panel.webview.html = this.getWebviewContent(
            html,
            tocItems,
            filename,
            markdown
        );
    }

    private updateFromActiveEditor() {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'markdown') {
            this.update(editor.document.getText(), editor.document.fileName);
        } else if (!this.rawMarkdown) {
            this.panel.webview.html = this.getEmptyContent();
        }
    }

    private createMarkdownIt(): MarkdownIt {
        const md = MarkdownIt({
            html: true,
            breaks: true,
            linkify: true,
        });

        const defaultHeadingOpen: MarkdownIt.Renderer.RenderRule =
            md.renderer.rules.heading_open ||
            ((tokens, idx, options, _env, self) => {
                return self.renderToken(tokens, idx, options);
            });

        md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
            const token = tokens[idx];
            const nextToken = tokens[idx + 1];
            if (nextToken && nextToken.type === 'inline') {
                const id = slugify(nextToken.content);
                token.attrSet('id', id);
            }
            return defaultHeadingOpen(tokens, idx, options, _env, self);
        };

        return md;
    }

    private extractTOC(markdown: string): TOCItem[] {
        const tokens = this.md.parse(markdown, {});
        const items: TOCItem[] = [];
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (token.type === 'heading_open') {
                const level = parseInt(token.tag.slice(1));
                const inline = tokens[i + 1];
                if (inline && inline.type === 'inline') {
                    items.push({
                        level,
                        text: inline.content,
                        id: slugify(inline.content),
                    });
                }
            }
        }
        return items;
    }

    private jsonEscape(s: string): string {
        return JSON.stringify(s).slice(1, -1);
    }

    private getEmptyContent(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    margin: 0;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-font-family);
    font-size: 14px;
    background: var(--vscode-editor-background);
}
</style>
</head>
<body>
<p>Open a Markdown file to preview</p>
</body>
</html>`;
    }

    private getWebviewContent(
        html: string,
        tocItems: TOCItem[],
        filename: string,
        rawMarkdown: string
    ): string {
        const hasTOC = tocItems.length > 0;
        const tocJSON = JSON.stringify(tocItems);
        const safeMarkdown = JSON.stringify(rawMarkdown);

        const tocListHTML = tocItems
            .map(
                (item) =>
                    `<li class="toc-item toc-level-${item.level}">
                        <a href="#${item.id}" title="${this.jsonEscape(item.text)}">${this.jsonEscape(item.text)}</a>
                    </li>`
            )
            .join('\n');

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${this.jsonEscape(filename)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

:root {
    --md-bg: var(--vscode-editor-background);
    --md-fg: var(--vscode-editor-foreground);
    --md-sidebar-bg: var(--vscode-sideBar-background);
    --md-border: var(--vscode-panel-border);
    --md-accent: var(--vscode-textLink-foreground);
    --md-code-bg: var(--vscode-textCodeBlock-background);
    --md-pre-bg: var(--vscode-textCodeBlock-background);
    --md-blockquote-bg: var(--vscode-textBlockQuote-background);
    --md-blockquote-fg: var(--vscode-textBlockQuote-foreground);
    --md-blockquote-border: var(--vscode-textBlockQuote-border);
    --md-muted: var(--vscode-descriptionForeground);
    --md-toolbar-bg: var(--vscode-titleBar-activeBackground);
    --md-toolbar-fg: var(--vscode-titleBar-activeForeground);
    --md-btn-bg: var(--vscode-button-secondaryBackground);
    --md-btn-fg: var(--vscode-button-secondaryForeground);
    --md-btn-hover-bg: var(--vscode-button-secondaryHoverBackground);
    --md-toc-fg: var(--vscode-sideBar-foreground);
    --md-toc-active-bg: var(--vscode-list-activeSelectionBackground);
    --md-toc-active-fg: var(--vscode-list-activeSelectionForeground);
    --md-toc-hover-bg: var(--vscode-list-hoverBackground);
    --md-scrollbar: var(--vscode-scrollbarSlider-background);
    --md-toast-bg: #24292f;
    --md-toast-fg: #ffffff;
    --md-bubble-bg: var(--vscode-editor-background);
    --md-bubble-fg: var(--vscode-descriptionForeground);
    --md-bubble-border: var(--vscode-panel-border);
    --md-table-stripe: var(--vscode-textBlockQuote-background);
    --md-heading-border: var(--vscode-panel-border);
    --md-code-fg: var(--vscode-editor-foreground);
    --md-input-accent: var(--vscode-focusBorder);
    --md-sidebar-title-fg: var(--vscode-sideBarTitle-foreground);
    --md-toggle-hover-bg: var(--vscode-toolbar-hoverBackground);
}

[data-theme="light"] {
    --md-bg: #ffffff;
    --md-fg: #24292f;
    --md-sidebar-bg: #f6f8fa;
    --md-border: #d0d7de;
    --md-accent: #0969da;
    --md-code-bg: #eff1f3;
    --md-pre-bg: #f0f2f5;
    --md-blockquote-bg: #f6f8fa;
    --md-blockquote-fg: #656d76;
    --md-blockquote-border: #0969da;
    --md-muted: #656d76;
    --md-toolbar-bg: #f6f8fa;
    --md-toolbar-fg: #24292f;
    --md-btn-bg: #f6f8fa;
    --md-btn-fg: #656d76;
    --md-btn-hover-bg: #eaeef2;
    --md-toc-fg: #57606a;
    --md-toc-active-bg: #d0d7de;
    --md-toc-active-fg: #1f2328;
    --md-toc-hover-bg: #eaeef2;
    --md-scrollbar: #d0d7de;
    --md-toast-bg: #24292f;
    --md-toast-fg: #ffffff;
    --md-bubble-bg: #ffffff;
    --md-bubble-fg: #656d76;
    --md-bubble-border: #d0d7de;
    --md-table-stripe: #f6f8fa;
    --md-heading-border: #d0d7de;
    --md-code-fg: #1f2328;
    --md-input-accent: #0969da;
    --md-sidebar-title-fg: #656d76;
    --md-toggle-hover-bg: #eaeef2;
}

[data-theme="dark"] {
    --md-bg: #0d1117;
    --md-fg: #c9d1d9;
    --md-sidebar-bg: #161b22;
    --md-border: #30363d;
    --md-accent: #58a6ff;
    --md-code-bg: #161b22;
    --md-pre-bg: #161b22;
    --md-blockquote-bg: #161b22;
    --md-blockquote-fg: #8b949e;
    --md-blockquote-border: #58a6ff;
    --md-muted: #8b949e;
    --md-toolbar-bg: #161b22;
    --md-toolbar-fg: #c9d1d9;
    --md-btn-bg: #21262d;
    --md-btn-fg: #8b949e;
    --md-btn-hover-bg: #30363d;
    --md-toc-fg: #8b949e;
    --md-toc-active-bg: #30363d;
    --md-toc-active-fg: #f0f6fc;
    --md-toc-hover-bg: #21262d;
    --md-scrollbar: #30363d;
    --md-toast-bg: #c9d1d9;
    --md-toast-fg: #0d1117;
    --md-bubble-bg: #21262d;
    --md-bubble-fg: #8b949e;
    --md-bubble-border: #30363d;
    --md-table-stripe: #161b22;
    --md-heading-border: #30363d;
    --md-code-fg: #c9d1d9;
    --md-input-accent: #58a6ff;
    --md-sidebar-title-fg: #8b949e;
    --md-toggle-hover-bg: #21262d;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif;
    color: var(--md-fg);
    background: var(--md-bg);
    display: flex;
    height: 100vh;
    overflow: hidden;
}

/* ====== TOC Sidebar ====== */
#toc-panel {
    width: 260px;
    min-width: 0;
    background: var(--md-sidebar-bg);
    border-left: 1px solid var(--md-border);
    display: flex;
    flex-direction: column;
    transition: width 0.25s ease, opacity 0.25s ease;
    overflow: hidden;
    flex-shrink: 0;
}
#toc-panel.collapsed { width: 0; opacity: 0; border-left: none; }

#toc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--md-border);
    flex-shrink: 0;
    min-width: 200px;
}
#toc-header .title {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--md-sidebar-title-fg);
    white-space: nowrap;
}

#toc-list {
    list-style: none;
    overflow-y: auto;
    flex: 1;
    padding: 8px 0;
    min-width: 200px;
}
#toc-list::-webkit-scrollbar { width: 4px; }
#toc-list::-webkit-scrollbar-thumb { background: var(--md-scrollbar); border-radius: 2px; }

.toc-item { padding: 0 16px; }
.toc-item a {
    display: block;
    padding: 5px 12px;
    color: var(--md-toc-fg);
    text-decoration: none;
    font-size: 13px;
    line-height: 1.5;
    border-radius: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 0.15s, color 0.15s;
}
.toc-item a:hover { background: var(--md-toc-hover-bg); }
.toc-item.active a {
    background: var(--md-toc-active-bg);
    color: var(--md-toc-active-fg);
    font-weight: 600;
    border-left: 3px solid var(--md-accent);
    padding-left: 9px;
}
.toc-level-1 a { font-weight: 600; font-size: 14px; }
.toc-level-2 a { padding-left: 24px; }
.toc-level-2.active a { padding-left: 21px; }
.toc-level-3 a { padding-left: 36px; }
.toc-level-3.active a { padding-left: 33px; }
.toc-level-4 a { padding-left: 48px; }
.toc-level-4.active a { padding-left: 45px; }
.toc-level-5 a { padding-left: 60px; }
.toc-level-5.active a { padding-left: 57px; }
.toc-level-6 a { padding-left: 72px; }
.toc-level-6.active a { padding-left: 69px; }

/* ====== Main Content ====== */
#main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
}

/* Toolbar */
#toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 20px;
    background: var(--md-toolbar-bg);
    border-bottom: 1px solid var(--md-border);
    flex-shrink: 0;
}
#toolbar .left { display: flex; align-items: center; gap: 10px; }
#toolbar .center { display: flex; align-items: center; gap: 2px; }
#toolbar .right { display: flex; align-items: center; gap: 4px; }
#toolbar .filename {
    font-size: 13px;
    font-weight: 500;
    color: var(--md-toolbar-fg);
}
#toolbar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 5px;
    border: 1px solid var(--md-border);
    border-radius: 4px;
    background: var(--md-btn-bg);
    color: var(--md-btn-fg);
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s;
    width: 28px;
    height: 28px;
}
#toolbar button:hover { background: var(--md-btn-hover-bg); color: var(--md-fg); }
#toolbar button svg { width: 14px; height: 14px; }
#toolbar .zoom-val {
    font-size: 12px;
    color: var(--md-muted);
    min-width: 38px;
    text-align: center;
    user-select: none;
}

/* Content Area */
#content-area {
    flex: 1;
    overflow-y: auto;
    padding: 32px 48px;
    max-width: 900px;
    margin: 0 auto;
    width: 100%;
}
#content-area::-webkit-scrollbar { width: 6px; }
#content-area::-webkit-scrollbar-thumb { background: var(--md-scrollbar); border-radius: 3px; }

/* Markdown Typography */
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 {
    color: var(--md-fg);
    margin: 24px 0 16px;
    font-weight: 600;
    line-height: 1.3;
}
.markdown-body h1 { font-size: 2em; border-bottom: 1px solid var(--md-heading-border); padding-bottom: 10px; }
.markdown-body h2 { font-size: 1.5em; border-bottom: 1px solid var(--md-heading-border); padding-bottom: 8px; }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1em; }

.markdown-body p { margin: 0 0 16px; line-height: 1.7; }

.markdown-body a { color: var(--md-accent); text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }

.markdown-body ul, .markdown-body ol { padding-left: 2em; margin: 0 0 16px; }
.markdown-body li { margin: 4px 0; line-height: 1.7; }

.markdown-body blockquote {
    margin: 0 0 16px;
    padding: 12px 16px;
    color: var(--md-blockquote-fg);
    background: var(--md-blockquote-bg);
    border-left: 4px solid var(--md-blockquote-border);
}
.markdown-body blockquote p:last-child { margin-bottom: 0; }

.markdown-body code {
    font-family: "Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace;
    font-size: 0.9em;
    background: var(--md-code-bg);
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--md-code-fg);
}
.markdown-body pre {
    position: relative;
    margin: 0 0 16px;
    background: var(--md-pre-bg);
    border-radius: 6px;
}
.markdown-body pre code {
    display: block;
    padding: 16px;
    overflow-x: auto;
    line-height: 1.5;
    font-size: 13px;
    background: transparent;
}
.markdown-body pre::-webkit-scrollbar { height: 4px; }
.markdown-body pre::-webkit-scrollbar-thumb { background: var(--md-scrollbar); border-radius: 2px; }

.copy-code-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--md-border);
    border-radius: 4px;
    background: var(--md-bg);
    color: var(--md-muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s;
}
.copy-code-btn svg { width: 14px; height: 14px; }
.markdown-body pre:hover .copy-code-btn { opacity: 1; }
.copy-code-btn:hover { background: var(--md-btn-hover-bg); color: var(--md-fg); }
.copy-code-btn.copied { background: var(--md-accent); color: #ffffff; border-color: var(--md-accent); }

.markdown-body table {
    border-collapse: collapse;
    margin: 0 0 16px;
    width: 100%;
}
.markdown-body th, .markdown-body td {
    border: 1px solid var(--md-border);
    padding: 8px 12px;
    text-align: left;
}
.markdown-body th { background: var(--md-sidebar-bg); font-weight: 600; }
.markdown-body tr:nth-child(even) { background: var(--md-table-stripe); }

.markdown-body hr {
    border: none;
    border-top: 1px solid var(--md-border);
    margin: 24px 0;
}

.markdown-body img { max-width: 100%; border-radius: 4px; }

.markdown-body input[type="checkbox"] {
    margin-right: 8px;
    accent-color: var(--md-input-accent);
}

/* ====== Toast ====== */
#toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(80px);
    background: var(--md-toast-bg);
    color: var(--md-toast-fg);
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    transition: transform 0.3s ease;
    z-index: 999;
    pointer-events: none;
}
#toast.show { transform: translateX(-50%) translateY(0); }

/* Responsive: auto-collapse TOC on narrow width */
@media (max-width: 720px) {
    #toc-panel:not(.collapsed) { width: 260px; }
}

/* No TOC state */
body.no-toc #toc-panel { display: none; }
body.no-toc #toggle-toc-side { display: none; }

/* ====== Scroll Bubble ====== */
#scroll-bubble {
    position: fixed;
    bottom: 32px;
    right: var(--bubble-right, 32px);
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 99;
    transition: right 0.25s ease;
}
#scroll-bubble button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 1px solid var(--md-bubble-border);
    border-radius: 50%;
    background: var(--md-bubble-bg);
    color: var(--md-bubble-fg);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    transition: background 0.15s, color 0.15s, opacity 0.3s;
    opacity: 0.6;
}
#scroll-bubble button:hover { background: var(--md-accent); color: #ffffff; opacity: 1; }
#scroll-bubble button svg { width: 16px; height: 16px; }

/* ====== Theme Menu ====== */
#theme-btn.active-theme { color: var(--md-accent); border-color: var(--md-accent); }
</style>
</head>
<body class="${hasTOC ? '' : 'no-toc'}">
<div id="main">
    <div id="toolbar">
        <div class="left">
            <span class="filename">${this.jsonEscape(filename)}</span>
        </div>
        <div class="center">
            <button id="zoom-out" title="Zoom out">
                <svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M2 7.5a.5.5 0 01.5-.5h8a.5.5 0 010 1h-8a.5.5 0 01-.5-.5z"/></svg>
            </button>
            <span class="zoom-val" id="zoom-level">100%</span>
            <button id="zoom-in" title="Zoom in">
                <svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 2a.5.5 0 01.5.5v5h5a.5.5 0 010 1h-5v5a.5.5 0 01-1 0v-5h-5a.5.5 0 010-1h5v-5A.5.5 0 018 2z"/></svg>
            </button>
        </div>
        <div class="right">
            <button id="toggle-toc-side" title="Toggle Table of Contents" aria-label="Toggle TOC">
                <svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M2 3.5a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5zm0 4a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5zm0 4a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5z"/></svg>
            </button>
            <button id="theme-btn" title="Switch theme (Auto / Light / Dark)">
                <svg id="theme-icon-auto" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M0 2.5A1.5 1.5 0 011.5 1h13A1.5 1.5 0 0116 2.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 010 11.5v-9zM1.5 2a.5.5 0 00-.5.5v9a.5.5 0 00.5.5h13a.5.5 0 00.5-.5v-9a.5.5 0 00-.5-.5h-13z"/><path d="M2 3h12v7H2V3z"/></svg>
                <svg id="theme-icon-light" viewBox="0 0 16 16" fill="currentColor" style="display:none"><path fill-rule="evenodd" d="M8 1.5a.5.5 0 01.5.5v1a.5.5 0 01-1 0V2a.5.5 0 01.5-.5zm4.95 1.55a.5.5 0 010 .707l-.707.707a.5.5 0 11-.707-.707l.707-.707a.5.5 0 01.707 0zm1.55 4.45a.5.5 0 010 .5h-1a.5.5 0 010-1h1a.5.5 0 010 .5zM8 11.5a.5.5 0 01.5.5v1a.5.5 0 01-1 0v-1a.5.5 0 01.5-.5zm-4.95 1.55a.5.5 0 010-.707l.707-.707a.5.5 0 01.707.707l-.707.707a.5.5 0 01-.707 0zM1.5 7.5a.5.5 0 010-.5h1a.5.5 0 010 1h-1a.5.5 0 010-.5zm1.55-4.45a.5.5 0 01.707 0l.707.707a.5.5 0 01-.707.707l-.707-.707a.5.5 0 010-.707zM8 4.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/></svg>
                <svg id="theme-icon-dark" viewBox="0 0 16 16" fill="currentColor" style="display:none"><path fill-rule="evenodd" d="M6 .278a.768.768 0 01.08.858 7.208 7.208 0 00-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 01.81.316.733.733 0 01-.031.893A8.349 8.349 0 018.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 016 .278z"/></svg>
            </button>
            <button id="copy-all" title="Copy Markdown source">
                <svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M4 1.5h8.5a1 1 0 011 1V12h-1V2.5H4v-1zM2.5 4h8a.5.5 0 01.5.5v9a.5.5 0 01-.5.5h-8a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5zM3 5v8h7V5H3z"/></svg>
            </button>
        </div>
    </div>

    <div id="content-area">
        <div class="markdown-body">${html}</div>
    </div>
</div>

<div id="toc-panel">
    <div id="toc-header">
        <span class="title">Contents</span>
    </div>
    <ul id="toc-list">${tocListHTML}</ul>
</div>

<div id="toast"></div>

<div id="scroll-bubble">
    <button id="scroll-top" title="Back to top">
        <svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 15a.5.5 0 00.5-.5V2.707l4.146 4.147a.5.5 0 00.708-.708l-5-5a.5.5 0 00-.708 0l-5 5a.5.5 0 10.708.708L7.5 2.707V14.5a.5.5 0 00.5.5z"/></svg>
    </button>
    <button id="scroll-bottom" title="Go to bottom">
        <svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 1a.5.5 0 01.5.5v11.793l4.146-4.147a.5.5 0 01.708.708l-5 5a.5.5 0 01-.708 0l-5-5a.5.5 0 11.708-.708L7.5 13.293V1.5A.5.5 0 018 1z"/></svg>
    </button>
</div>

<script type="text/markdown-source" id="markdown-source">${safeMarkdown}</script>

<script>
(function() {
    var tocItems = ${tocJSON};
    var tocPanel = document.getElementById('toc-panel');
    var tocList = document.getElementById('toc-list');
    var contentArea = document.getElementById('content-area');
    var toast = document.getElementById('toast');
    var toastTimer;

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function() {
            toast.classList.remove('show');
        }, 2000);
    }

    // ====== TOC Toggle ======
    var toggleTocSideBtn = document.getElementById('toggle-toc-side');
    var scrollBubble = document.getElementById('scroll-bubble');
    var tocWidth = 260;

    function updateBubblePosition() {
        if (tocPanel.classList.contains('collapsed')) {
            scrollBubble.style.setProperty('--bubble-right', '32px');
        } else {
            scrollBubble.style.setProperty('--bubble-right', (32 + tocWidth) + 'px');
        }
    }

    function collapseTOC() {
        tocPanel.classList.add('collapsed');
        updateBubblePosition();
    }
    function expandTOC() {
        tocPanel.classList.remove('collapsed');
        updateBubblePosition();
    }

    updateBubblePosition();

    if (toggleTocSideBtn) {
        toggleTocSideBtn.addEventListener('click', function() {
            if (tocPanel.classList.contains('collapsed')) {
                expandTOC();
            } else {
                collapseTOC();
            }
        });
    }

    // ====== TOC Click -> Scroll ======
    if (tocList) {
        tocList.addEventListener('click', function(e) {
            var a = e.target.closest('a');
            if (!a) { return; }
            e.preventDefault();
            var id = a.getAttribute('href').slice(1);
            var target = document.getElementById(id);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }

    // ====== Scroll Spy ======
    var tocLinks = tocList ? tocList.querySelectorAll('a') : [];
    var headingIds = [];
    tocLinks.forEach(function(a) {
        var id = a.getAttribute('href').slice(1);
        headingIds.push(id);
    });

    var activeId = null;

    function updateActiveHeading() {
        var newActive = null;
        var containerTop = contentArea.getBoundingClientRect().top;

        for (var i = 0; i < headingIds.length; i++) {
            var el = document.getElementById(headingIds[i]);
            if (!el) { continue; }
            var rect = el.getBoundingClientRect();
            if (rect.top >= containerTop - 1 && rect.top < containerTop + contentArea.offsetHeight) {
                newActive = headingIds[i];
                break;
            }
        }

        if (newActive === null) {
            for (var i = headingIds.length - 1; i >= 0; i--) {
                var el = document.getElementById(headingIds[i]);
                if (!el) { continue; }
                var rect = el.getBoundingClientRect();
                if (rect.top < containerTop) {
                    newActive = headingIds[i];
                    break;
                }
            }
        }

        if (activeId !== newActive) {
            activeId = newActive;
            tocLinks.forEach(function(link) {
                link.parentElement.classList.toggle(
                    'active',
                    link.getAttribute('href') === '#' + activeId
                );
            });
        }
    }

    var observer;
    if ('IntersectionObserver' in window && headingIds.length > 0) {
        observer = new IntersectionObserver(function(entries) {
            updateActiveHeading();
        }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });

        headingIds.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) { observer.observe(el); }
        });
    }

    if (headingIds.length > 0) {
        contentArea.addEventListener('scroll', function() {
            requestAnimationFrame(updateActiveHeading);
        });
    }

    // ====== Copy Code Block ======
    var copyIcon = '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M4 1.5h8.5a1 1 0 011 1V12h-1V2.5H4v-1zM2.5 4h8a.5.5 0 01.5.5v9a.5.5 0 01-.5.5h-8a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5zM3 5v8h7V5H3z"/></svg>';
    var checkIcon = '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>';

    document.querySelectorAll('.markdown-body pre').forEach(function(pre) {
        var btn = document.createElement('button');
        btn.className = 'copy-code-btn';
        btn.innerHTML = copyIcon;
        btn.title = 'Copy code';
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var code = pre.querySelector('code');
            var text = code ? code.textContent || '' : pre.textContent || '';
            navigator.clipboard.writeText(text).then(function() {
                btn.innerHTML = checkIcon;
                btn.classList.add('copied');
                setTimeout(function() {
                    btn.innerHTML = copyIcon;
                    btn.classList.remove('copied');
                }, 2000);
            }).catch(function() {
                var vscode = acquireVsCodeApi ? acquireVsCodeApi() : null;
                if (vscode) {
                    vscode.postMessage({ command: 'copy', text: text });
                    btn.innerHTML = checkIcon;
                    btn.classList.add('copied');
                    setTimeout(function() {
                        btn.innerHTML = copyIcon;
                        btn.classList.remove('copied');
                    }, 2000);
                }
            });
        });
        pre.appendChild(btn);
    });

    // ====== Copy All ======
    var copyAllBtn = document.getElementById('copy-all');
    if (copyAllBtn) {
        copyAllBtn.addEventListener('click', function() {
            var sourceEl = document.getElementById('markdown-source');
            var text = sourceEl ? sourceEl.textContent : '';
            navigator.clipboard.writeText(text).then(function() {
                showToast('Markdown source copied to clipboard');
            }).catch(function() {
                var vscode = acquireVsCodeApi ? acquireVsCodeApi() : null;
                if (vscode) {
                    vscode.postMessage({ command: 'copy', text: text });
                }
                showToast('Markdown source copied to clipboard');
            });
        });
    }

    // ====== Theme Switch ======
    var themes = ['default', 'light', 'dark'];
    var themeLabels = ['System', 'Light', 'Dark'];
    var currentTheme = 0;
    var themeBtn = document.getElementById('theme-btn');
    var iconAuto = document.getElementById('theme-icon-auto');
    var iconLight = document.getElementById('theme-icon-light');
    var iconDark = document.getElementById('theme-icon-dark');

    function showThemeIcon(theme) {
        iconAuto.style.display = theme === 'default' ? '' : 'none';
        iconLight.style.display = theme === 'light' ? '' : 'none';
        iconDark.style.display = theme === 'dark' ? '' : 'none';
    }

    function applyTheme(theme) {
        if (theme === 'default') {
            document.body.removeAttribute('data-theme');
        } else {
            document.body.setAttribute('data-theme', theme);
        }
        showThemeIcon(theme);
        themeBtn.title = 'Theme: ' + themeLabels[themes.indexOf(theme)];
    }

    if (themeBtn) {
        themeBtn.addEventListener('click', function() {
            currentTheme = (currentTheme + 1) % themes.length;
            applyTheme(themes[currentTheme]);
        });
    }

    // ====== Zoom ======
    var zoomLevel = 100;
    var zoomValEl = document.getElementById('zoom-level');
    var markdownBody = document.querySelector('.markdown-body');

    function applyZoom() {
        markdownBody.style.fontSize = zoomLevel + '%';
        zoomValEl.textContent = zoomLevel + '%';
    }

    document.getElementById('zoom-in').addEventListener('click', function() {
        if (zoomLevel < 200) {
            zoomLevel = zoomLevel + 10;
            applyZoom();
        }
    });

    document.getElementById('zoom-out').addEventListener('click', function() {
        if (zoomLevel > 50) {
            zoomLevel = zoomLevel - 10;
            applyZoom();
        }
    });

    // ====== Ctrl + Wheel Zoom ======
    contentArea.addEventListener('wheel', function(e) {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.deltaY < 0 && zoomLevel < 200) {
                zoomLevel = zoomLevel + 10;
            } else if (e.deltaY > 0 && zoomLevel > 50) {
                zoomLevel = zoomLevel - 10;
            }
            applyZoom();
        }
    }, { passive: false });

    // ====== Scroll Buttons ======
    function fastScrollTo(targetY) {
        var startY = contentArea.scrollTop;
        var diff = targetY - startY;
        var duration = 300;
        var startTime = null;

        function step(timestamp) {
            if (!startTime) { startTime = timestamp; }
            var elapsed = timestamp - startTime;
            var progress = Math.min(elapsed / duration, 1);
            var ease = 1 - Math.pow(1 - progress, 3);
            contentArea.scrollTop = startY + diff * ease;
            if (progress < 1) {
                requestAnimationFrame(step);
            }
        }

        requestAnimationFrame(step);
    }

    document.getElementById('scroll-top').addEventListener('click', function() {
        fastScrollTo(0);
    });

    document.getElementById('scroll-bottom').addEventListener('click', function() {
        fastScrollTo(contentArea.scrollHeight);
    });
})();
</script>
</body>
</html>`;
    }

    public dispose() {
        MarkdownPreviewPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) {
                d.dispose();
            }
        }
    }
}
