import * as vscode from 'vscode';
import MarkdownIt = require('markdown-it');

interface TOCItem {
    level: number;
    text: string;
    id: string;
    line: number;
}

interface TOCNode {
    level: number;
    text: string;
    id: string;
    line: number;
    children: TOCNode[];
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
    private currentTheme: string = 'light';
    private syncVersion: number = 0;
    private initialized: boolean = false;
    private updateTimer: NodeJS.Timeout | undefined;
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
                } else if (message.command === 'refresh') {
                    void this.refreshFromSource();
                } else if (message.command === 'set-theme') {
                    this.currentTheme = message.theme;
                } else if (message.command === 'scroll-editor') {
                    const editor = this.findVisibleMarkdownEditor();
                    if (editor) {
                        const line = Math.max(0, Math.min(message.line - 1, editor.document.lineCount - 1));
                        const position = new vscode.Position(line, 0);
                        const version = ++this.syncVersion;
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(
                            new vscode.Range(position, position),
                            vscode.TextEditorRevealType.InCenter
                        );
                        setTimeout(() => {
                            if (this.syncVersion === version) {
                                this.syncVersion = 0;
                            }
                        }, 500);
                    }
                }
            },
            null,
            this.disposables
        );

        this.updateFromActiveEditor();

        vscode.window.onDidChangeTextEditorSelection(
            (e) => {
                if (e.textEditor.document.languageId === 'markdown') {
                    this.syncEditorToPreview(e.textEditor);
                }
            },
            null,
            this.disposables
        );
    }

    private findVisibleMarkdownEditor(): vscode.TextEditor | undefined {
        const markdownEditors = vscode.window.visibleTextEditors.filter(
            (editor) => editor.document.languageId === 'markdown'
        );

        if (this.currentFile) {
            const matchingEditor = markdownEditors.find(
                (editor) => editor.document.fileName === this.currentFile
            );
            if (matchingEditor) {
                return matchingEditor;
            }
        }

        return markdownEditors[0];
    }

    private syncEditorToPreview(editor: vscode.TextEditor) {
        if (this.syncVersion !== 0) { return; }
        const line = editor.selection.active.line;
        const text = editor.document.getText();
        const lines = text.split('\n');
        let headingLine = -1;
        for (let i = line; i >= 0; i--) {
            if (/^#{1,6}\s/.test(lines[i])) {
                headingLine = i;
                break;
            }
        }
        if (headingLine >= 0) {
            const headingId = slugify(
                lines[headingLine].replace(/^#{1,6}\s+/, '').trim()
            );
            this.panel.webview.postMessage({
                command: 'scroll-preview',
                id: headingId,
            });
        }
    }

    public update(markdown: string, filePath?: string, immediate: boolean = false) {
        this.rawMarkdown = markdown;
        this.currentFile = filePath || this.currentFile;

        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }

        if (immediate) {
            this.doUpdate();
        } else {
            this.updateTimer = setTimeout(() => {
                this.doUpdate();
            }, 300);
        }
    }

    private doUpdate() {
        const markdown = this.rawMarkdown;
        const tocItems = this.extractTOC(markdown);
        const tocTree = this.buildTOCTree(tocItems);
        const html = this.md.render(markdown);
        const filename = this.currentFile
            ? this.currentFile.replace(/^.*[\\/]/, '')
            : 'untitled.md';

        this.panel.title = filename;

        if (!this.initialized) {
            this.panel.webview.html = this.getWebviewContent(
                html,
                tocTree,
                tocItems,
                filename,
                markdown,
                this.currentTheme
            );
            this.initialized = true;
        } else {
            this.panel.webview.postMessage({
                command: 'update-content',
                html: html,
                tocTree: tocTree,
                tocItems: tocItems,
                filename: filename,
                rawMarkdown: markdown,
            });
        }
    }

    private updateFromActiveEditor() {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'markdown') {
            this.update(editor.document.getText(), editor.document.fileName, true);
        } else if (!this.rawMarkdown) {
            this.panel.webview.html = this.getEmptyContent();
        }
    }

    private async refreshFromSource() {
        const openDocument = this.currentFile
            ? vscode.workspace.textDocuments.find(
                (document) => document.fileName === this.currentFile
            )
            : undefined;

        if (openDocument) {
            if (openDocument.isDirty || openDocument.isUntitled) {
                this.update(openDocument.getText(), openDocument.fileName, true);
                return;
            }

            try {
                const bytes = await vscode.workspace.fs.readFile(openDocument.uri);
                this.update(Buffer.from(bytes).toString('utf8'), openDocument.fileName, true);
                return;
            } catch {
                this.update(openDocument.getText(), openDocument.fileName, true);
                return;
            }
        }

        if (this.currentFile) {
            try {
                const uri = vscode.Uri.file(this.currentFile);
                const bytes = await vscode.workspace.fs.readFile(uri);
                this.update(Buffer.from(bytes).toString('utf8'), this.currentFile, true);
                return;
            } catch {
                // Fall back to the active editor below.
            }
        }

        this.updateFromActiveEditor();
    }

    private escapeHtml(value: string): string {
        return value.replace(/[&<>"]/g, (char) => {
            switch (char) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                default: return char;
            }
        });
    }

    private findLineEnd(value: string, start: number): number {
        const lineEnd = value.indexOf('\n', start);
        return lineEnd === -1 ? value.length : lineEnd;
    }

    private isLineLeadingHash(value: string, index: number): boolean {
        for (let i = index - 1; i >= 0; i--) {
            const char = value[i];
            if (char === '\n' || char === '\r') {
                return true;
            }
            if (char !== ' ' && char !== '\t') {
                return false;
            }
        }

        return true;
    }

    private getCodeCommentEnd(value: string, index: number): number | undefined {
        if (value.startsWith('<!--', index)) {
            const end = value.indexOf('-->', index + 4);
            return end === -1 ? value.length : end + 3;
        }

        if (value.startsWith('/*', index)) {
            const end = value.indexOf('*/', index + 2);
            return end === -1 ? value.length : end + 2;
        }

        if (value.startsWith('//', index) && value[index - 1] !== ':') {
            return this.findLineEnd(value, index);
        }

        if (value[index] === '#') {
            const previous = value[index - 1];
            const next = value[index + 1];
            const isInlineComment = (previous === ' ' || previous === '\t') &&
                (next === ' ' || next === '\t' || next === undefined);
            if (this.isLineLeadingHash(value, index) || isInlineComment) {
                return this.findLineEnd(value, index);
            }
        }

        return undefined;
    }

    private renderCodeWithComments(value: string): string {
        let html = '';
        let index = 0;
        let quote: string | undefined;

        while (index < value.length) {
            const char = value[index];

            if (quote) {
                html += this.escapeHtml(char);
                if (char === '\\' && index + 1 < value.length) {
                    html += this.escapeHtml(value[index + 1]);
                    index += 2;
                    continue;
                }
                if (char === quote) {
                    quote = undefined;
                }
                index++;
                continue;
            }

            const commentEnd = this.getCodeCommentEnd(value, index);
            if (commentEnd !== undefined) {
                html += `<span class="code-comment">${this.escapeHtml(value.slice(index, commentEnd))}</span>`;
                index = commentEnd;
                continue;
            }

            if (char === '"' || char === '\'' || char === '`') {
                quote = char;
            }
            html += this.escapeHtml(char);
            index++;
        }

        return html;
    }

    private renderCodeBlock(content: string, language: string = ''): string {
        const sanitizedLanguage = language.replace(/[^\w-]/g, '');
        const classAttribute = sanitizedLanguage
            ? ` class="language-${this.escapeHtml(sanitizedLanguage)}"`
            : '';

        return `<pre><code${classAttribute}>${this.renderCodeWithComments(content)}</code></pre>\n`;
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

        md.renderer.rules.fence = (tokens, idx) => {
            const token = tokens[idx];
            const language = token.info.trim().split(/\s+/)[0] || '';
            if (language === 'mermaid') {
                const escapedContent = this.escapeHtml(token.content);
                return `<div class="mermaid-block">`
                    + `<div class="mermaid-graph"><div class="mermaid">${escapedContent}</div></div>`
                    + `<div class="mermaid-context" style="display:none">${this.renderCodeBlock(token.content, 'mermaid')}</div>`
                    + `</div>\n`;
            }
            return this.renderCodeBlock(token.content, language);
        };

        md.renderer.rules.code_block = (tokens, idx) => {
            return this.renderCodeBlock(tokens[idx].content);
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
                        line: (token.map ? token.map[0] : 0) + 1,
                    });
                }
            }
        }
        return items;
    }

    private buildTOCTree(items: TOCItem[]): TOCNode[] {
        const root: TOCNode[] = [];
        const stack: TOCNode[] = [];
        for (const item of items) {
            const node: TOCNode = { ...item, children: [] };
            while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
                stack.pop();
            }
            if (stack.length === 0) {
                root.push(node);
            } else {
                stack[stack.length - 1].children.push(node);
            }
            stack.push(node);
        }
        return root;
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

    private renderTOCNode(node: TOCNode): string {
        const hasChildren = node.children.length > 0;
        const toggle = hasChildren
            ? `<span class="toc-toggle">▼</span>`
            : '';
        const childrenHTML = hasChildren
            ? `<ul>${node.children.map((c) => this.renderTOCNode(c)).join('')}</ul>`
            : '';
        return `<li class="toc-item toc-level-${node.level}">
            ${toggle}<a href="#${node.id}" title="${this.jsonEscape(node.text)}">${this.jsonEscape(node.text)}</a>
            ${childrenHTML}
        </li>`;
    }

    private getWebviewContent(
        html: string,
        tocTree: TOCNode[],
        tocItems: TOCItem[],
        filename: string,
        rawMarkdown: string,
        initialTheme: string
    ): string {
        const hasTOC = tocTree.length > 0;
        const tocJSON = JSON.stringify(tocItems);
        const safeMarkdown = JSON.stringify(rawMarkdown);

        const webviewScriptUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')
        );

        const tocListHTML = tocTree
            .map((node) => this.renderTOCNode(node))
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
    --md-code-basic-fg: #006400;
    --md-code-comment-fg: #808080;
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
    --md-code-basic-fg: #006400;
    --md-code-comment-fg: #808080;
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
    --md-code-basic-fg: #006400;
    --md-code-comment-fg: #8b949e;
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
    min-width: 160px;
    max-width: 500px;
    background: var(--md-sidebar-bg);
    border-left: 1px solid var(--md-border);
    display: flex;
    flex-direction: column;
    transition: opacity 0.25s ease;
    overflow: hidden;
    flex-shrink: 0;
    position: relative;
}
#toc-panel.collapsed {
    display: none;
    width: 0 !important;
    min-width: 0 !important;
    max-width: 0 !important;
    flex-basis: 0 !important;
    border-left: none;
}

#toc-resize-handle {
    position: absolute;
    top: 0;
    left: -5px;
    width: 10px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
}
#toc-resize-handle:hover,
#toc-resize-handle.dragging {
    background: var(--md-accent);
    opacity: 0.25;
}

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

.toc-item { padding: 0 5px 0 0; }
.toc-item a {
    display: inline-block;
    vertical-align: middle;
    padding: 5px 12px 5px 4px;
    color: var(--md-toc-fg);
    text-decoration: none;
    font-size: 13px;
    line-height: 1.5;
    border-radius: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: calc(100% - 5px);
    transition: background 0.15s, color 0.15s;
}
.toc-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 20px;
    font-size: 10px;
    cursor: pointer;
    color: var(--md-muted);
    user-select: none;
    vertical-align: middle;
    flex-shrink: 0;
}
.toc-toggle:hover { color: var(--md-fg); }
.toc-item.collapsed > .toc-toggle { transform: rotate(-90deg); }
.toc-item.collapsed > ul { display: none; }
.toc-item ul { list-style: none; padding-left: 0; }
.toc-item a:hover { background: var(--md-toc-hover-bg); }
.toc-item.active > a {
    background: var(--md-toc-active-bg);
    color: var(--md-toc-active-fg);
    font-weight: 600;
    border-left: 3px solid var(--md-accent);
    padding-left: 1px;
}
.toc-level-2 a { padding-left: 20px; }
.toc-level-2.active > a { padding-left: 17px; }
.toc-level-3 a { padding-left: 36px; }
.toc-level-3.active > a { padding-left: 33px; }
.toc-level-4 a { padding-left: 52px; }
.toc-level-4.active > a { padding-left: 49px; }
.toc-level-5 a { padding-left: 68px; }
.toc-level-5.active > a { padding-left: 65px; }
.toc-level-6 a { padding-left: 84px; }
.toc-level-6.active > a { padding-left: 81px; }
.toc-level-1 > a { font-weight: 600; font-size: 14px; }

/* ====== Main Content ====== */
#main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
}

/* Context Menu */
#context-menu,
#mermaid-context-menu {
    position: fixed;
    display: none;
    flex-direction: column;
    min-width: 190px;
    padding: 4px;
    background: var(--md-toolbar-bg);
    border: 1px solid var(--md-border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    z-index: 1000;
}
#context-menu.show,
#mermaid-context-menu.show { display: flex; }
#context-menu button,
#mermaid-context-menu button {
    display: block;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--md-toolbar-fg);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    text-align: left;
}
#context-menu button:hover,
#mermaid-context-menu button:hover { background: var(--md-btn-hover-bg); color: var(--md-fg); }
#context-menu button:disabled,
#mermaid-context-menu button:disabled {
    color: var(--md-muted);
    cursor: default;
    opacity: 0.55;
}
#context-menu button:disabled:hover,
#mermaid-context-menu button:disabled:hover { background: transparent; color: var(--md-muted); }
#context-menu .separator,
#mermaid-context-menu .separator {
    height: 1px;
    margin: 4px 0;
    background: var(--md-border);
}

/* Content Area */
#content-area {
    flex: 1;
    overflow-y: auto;
    padding: 32px 5px;
    max-width: none;
    margin: 0;
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
    font-size: 0.9em;
    background: transparent;
    color: var(--md-code-basic-fg);
}
.markdown-body pre code .code-comment { color: var(--md-code-comment-fg); font-style: italic; }
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

.mermaid-block {
    position: relative;
    margin: 0 0 16px;
    border-radius: 6px;
    background: #fff9e6;
}
.mermaid-block .mermaid-graph {
    overflow: hidden;
    cursor: grab;
}
.mermaid-block .mermaid-graph.panning {
    cursor: grabbing;
}
.mermaid-block .mermaid {
    display: flex;
    justify-content: center;
    padding: 16px;
    user-select: none;
    transform-origin: center center;
}
.mermaid-block .mermaid svg {
    max-width: 100%;
    height: auto;
}
.mermaid-block .mermaid-context pre {
    margin: 0;
    background: transparent;
}
.mermaid-block .mermaid-context pre code {
    color: var(--md-code-basic-fg);
    background: transparent;
}

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

/* ====== Zoom Indicator ====== */
#zoom-indicator {
    position: fixed;
    background: rgba(0,0,0,0.45);
    color: #ffffff;
    padding: 16px 32px;
    border-radius: 12px;
    font-size: 28px;
    font-weight: 600;
    opacity: 0;
    pointer-events: none;
    z-index: 998;
    transition: opacity 0.25s ease, transform 0.25s ease;
    transform: translate(-50%, -50%) scale(0.8);
}
#zoom-indicator.show {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
}

/* Responsive: auto-collapse TOC on narrow width */
@media (max-width: 720px) {
    #toc-panel:not(.collapsed) { width: 260px; }
}

/* No TOC state */
body.no-toc #toc-panel { display: none; }

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

</style>
</head>
<body class="${hasTOC ? '' : 'no-toc'}">
<div id="main">
    <div id="content-area">
        <div class="markdown-body">${html}</div>
    </div>
</div>

<div id="toc-panel">
    <div id="toc-resize-handle"></div>
    <div id="toc-header">
        <span class="title">Contents</span>
    </div>
    <ul id="toc-list">${tocListHTML}</ul>
</div>

<div id="toast"></div>
<div id="zoom-indicator">100%</div>

<div id="context-menu" role="menu" aria-hidden="true">
    <button type="button" data-action="refresh">Refresh preview</button>
    <button type="button" data-action="toggle-toc">Toggle contents</button>
    <button type="button" data-action="zoom-fit">Zoom 100%</button>
    <div class="separator" aria-hidden="true"></div>
    <button type="button" data-action="theme">Switch theme</button>
    <button type="button" data-action="copy-source">Copy Markdown source</button>
</div>

<div id="mermaid-context-menu" role="menu" aria-hidden="true">
    <button type="button" data-action="reset-zoom">Reset zoom</button>
    <button type="button" data-action="copy-code">Copy mermaid code</button>
    <button type="button" data-action="copy-png">Copy PNG</button>
    <div class="separator" aria-hidden="true"></div>
    <button type="button" data-action="show-graph">Show graph</button>
    <button type="button" data-action="show-source">Show source</button>
</div>

<div id="scroll-bubble">
    <button id="scroll-top" title="Back to top">
        <svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 15a.5.5 0 00.5-.5V2.707l4.146 4.147a.5.5 0 00.708-.708l-5-5a.5.5 0 00-.708 0l-5 5a.5.5 0 10.708.708L7.5 2.707V14.5a.5.5 0 00.5.5z"/></svg>
    </button>
    <button id="scroll-bottom" title="Go to bottom">
        <svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 1a.5.5 0 01.5.5v11.793l4.146-4.147a.5.5 0 01.708.708l-5 5a.5.5 0 01-.708 0l-5-5a.5.5 0 11.708-.708L7.5 13.293V1.5A.5.5 0 018 1z"/></svg>
    </button>
</div>

<script type="text/markdown-source" id="markdown-source">${safeMarkdown}</script>

<script src="${webviewScriptUri}"></script>
<script>
(function() {
    var tocItems = ${tocJSON};
    var tocPanel = document.getElementById('toc-panel');
    var tocList = document.getElementById('toc-list');
    var contentArea = document.getElementById('content-area');
    var contextMenu = document.getElementById('context-menu');
    var mermaidContextMenu = document.getElementById('mermaid-context-menu');
    var currentMermaidBlock = null;
    var toast = document.getElementById('toast');
    var toastTimer;

    var vscodeApi = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;

    var copyIcon = '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M4 1.5h8.5a1 1 0 011 1V12h-1V2.5H4v-1zM2.5 4h8a.5.5 0 01.5.5v9a.5.5 0 01-.5.5h-8a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5zM3 5v8h7V5H3z"/></svg>';
    var checkIcon = '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>';

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function() {
            toast.classList.remove('show');
        }, 2000);
    }

    // ====== TOC Toggle ======
    var scrollBubble = document.getElementById('scroll-bubble');
    var tocWidth = 260;

    function getTOCWidth() {
        return parseInt(tocPanel.style.width) || tocWidth;
    }

    function updateBubblePosition() {
        if (document.body.classList.contains('no-toc') || tocPanel.classList.contains('collapsed')) {
            scrollBubble.style.setProperty('--bubble-right', '32px');
        } else {
            var w = getTOCWidth();
            scrollBubble.style.setProperty('--bubble-right', (32 + w) + 'px');
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

    function toggleTOC() {
        if (document.body.classList.contains('no-toc')) { return; }
        if (tocPanel.classList.contains('collapsed')) {
            expandTOC();
        } else {
            collapseTOC();
        }
    }

    updateBubblePosition();

    // ====== Context Menu ======
    function hideContextMenu() {
        if (!contextMenu) { return; }
        contextMenu.classList.remove('show');
        contextMenu.setAttribute('aria-hidden', 'true');
    }

    function showContextMenu(x, y) {
        if (!contextMenu) { return; }
        var toggleItem = contextMenu.querySelector('[data-action="toggle-toc"]');
        if (toggleItem) {
            toggleItem.disabled = document.body.classList.contains('no-toc');
        }

        contextMenu.classList.add('show');
        contextMenu.setAttribute('aria-hidden', 'false');

        var rect = contextMenu.getBoundingClientRect();
        var left = Math.min(x, window.innerWidth - rect.width - 8);
        var top = Math.min(y, window.innerHeight - rect.height - 8);
        contextMenu.style.left = Math.max(8, left) + 'px';
        contextMenu.style.top = Math.max(8, top) + 'px';
    }

    function hideMermaidContextMenu() {
        if (!mermaidContextMenu) { return; }
        mermaidContextMenu.classList.remove('show');
        mermaidContextMenu.setAttribute('aria-hidden', 'true');
    }

    function showMermaidContextMenu(x, y) {
        if (!mermaidContextMenu) { return; }
        var actions = currentMermaidBlock ? currentMermaidBlock.__mermaidActions : null;
        var inSource = actions ? actions.isSource() : false;
        var showGraphItem = mermaidContextMenu.querySelector('[data-action="show-graph"]');
        var showSourceItem = mermaidContextMenu.querySelector('[data-action="show-source"]');
        if (showGraphItem) { showGraphItem.disabled = !inSource; }
        if (showSourceItem) { showSourceItem.disabled = inSource; }

        mermaidContextMenu.classList.add('show');
        mermaidContextMenu.setAttribute('aria-hidden', 'false');

        var rect = mermaidContextMenu.getBoundingClientRect();
        var left = Math.min(x, window.innerWidth - rect.width - 8);
        var top = Math.min(y, window.innerHeight - rect.height - 8);
        mermaidContextMenu.style.left = Math.max(8, left) + 'px';
        mermaidContextMenu.style.top = Math.max(8, top) + 'px';
    }

    document.addEventListener('contextmenu', function(e) {
        if (e.target.closest('#context-menu') || e.target.closest('#mermaid-context-menu')) { return; }
        var mermaidBlock = e.target.closest('.mermaid-block');
        if (mermaidBlock) {
            e.preventDefault();
            hideContextMenu();
            currentMermaidBlock = mermaidBlock;
            showMermaidContextMenu(e.clientX, e.clientY);
            return;
        }
        if (e.target.closest('.markdown-body pre')) { return; }
        e.preventDefault();
        hideMermaidContextMenu();
        showContextMenu(e.clientX, e.clientY);
    });

    document.addEventListener('click', function(e) {
        if (e.target.closest('#context-menu') || e.target.closest('#mermaid-context-menu')) { return; }
        hideContextMenu();
        hideMermaidContextMenu();
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            hideContextMenu();
            hideMermaidContextMenu();
        }
    });

    if (contextMenu) {
        contextMenu.addEventListener('click', function(e) {
            var item = e.target.closest('[data-action]');
            if (!item || item.disabled) { return; }
            var action = item.getAttribute('data-action');
            hideContextMenu();
            if (action === 'refresh') {
                refreshPreview();
            } else if (action === 'toggle-toc') {
                toggleTOC();
            } else if (action === 'zoom-fit') {
                resetZoom();
            } else if (action === 'theme') {
                cycleTheme();
            } else if (action === 'copy-source') {
                copyMarkdownSource();
            }
        });
    }

    if (mermaidContextMenu) {
        mermaidContextMenu.addEventListener('click', function(e) {
            var item = e.target.closest('[data-action]');
            if (!item || item.disabled) { return; }
            var action = item.getAttribute('data-action');
            hideMermaidContextMenu();
            var actions = currentMermaidBlock ? currentMermaidBlock.__mermaidActions : null;
            if (!actions) { return; }
            if (action === 'reset-zoom') {
                actions.resetZoom();
            } else if (action === 'copy-code') {
                actions.copyCode();
            } else if (action === 'copy-png') {
                actions.copyPng();
            } else if (action === 'show-graph') {
                actions.showGraph();
            } else if (action === 'show-source') {
                actions.showSource();
            }
        });
    }

    // ====== TOC Resize ======
    var resizeHandle = document.getElementById('toc-resize-handle');
    var isResizing = false;
    var startX, startWidth;

    resizeHandle.addEventListener('mousedown', function(e) {
        if (tocPanel.classList.contains('collapsed')) { return; }
        isResizing = true;
        startX = e.clientX;
        startWidth = tocPanel.offsetWidth;
        resizeHandle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        if (!isResizing) { return; }
        var newWidth = startWidth + (startX - e.clientX);
        newWidth = Math.max(160, Math.min(500, newWidth));
        tocPanel.style.width = newWidth + 'px';
        updateBubblePosition();
    });

    document.addEventListener('mouseup', function() {
        if (!isResizing) { return; }
        isResizing = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    // ====== TOC Click -> Scroll ======
    var headingLines = {};
    var tocData = ${tocJSON};
    tocData.forEach(function(item) {
        headingLines[item.id] = item.line;
    });

    if (tocList) {
        tocList.addEventListener('click', function(e) {
            var toggle = e.target.closest('.toc-toggle');
            if (toggle) {
                var item = toggle.parentElement;
                item.classList.toggle('collapsed');
                return;
            }
            var a = e.target.closest('a');
            if (!a) { return; }
            e.preventDefault();
            var id = a.getAttribute('href').slice(1);
            var target = document.getElementById(id);
            if (target) {
                lastSyncFromExtension = Date.now();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            // Sync editor
            if (headingLines[id]) {
                if (vscodeApi) {
                    vscodeApi.postMessage({ command: 'scroll-editor', line: headingLines[id] });
                }
            }
        });
    }

    // ====== Scroll Spy ======
    var tocLinks = tocList ? tocList.querySelectorAll('.toc-item > a') : [];
    var headingIds = [];
    tocData.forEach(function(item) {
        headingIds.push(item.id);
    });

    var activeId = null;
    var lastSyncFromExtension = 0;

    function expandAncestors(el) {
        var parent = el.parentElement;
        while (parent) {
            if (parent.tagName === 'LI' && parent.classList.contains('toc-item')) {
                parent.classList.remove('collapsed');
            }
            parent = parent.parentElement;
        }
    }

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
            var activeLink = null;
            tocLinks.forEach(function(link) {
                var li = link.parentElement;
                var isActive = link.getAttribute('href') === '#' + activeId;
                li.classList.toggle('active', isActive);
                if (isActive) {
                    expandAncestors(li);
                    activeLink = link;
                }
            });

            // Scroll TOC to keep active item visible
            if (activeLink && tocList) {
                var linkRect = activeLink.getBoundingClientRect();
                var listRect = tocList.getBoundingClientRect();
                if (linkRect.top < listRect.top || linkRect.bottom > listRect.bottom) {
                    activeLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }

            if (activeId && headingLines[activeId]) {
                if (vscodeApi && Date.now() - lastSyncFromExtension > 500) {
                    vscodeApi.postMessage({ command: 'scroll-editor', line: headingLines[activeId] });
                }
            }
        }
    }

    // Sync: listen for scroll-preview messages from extension
    window.addEventListener('message', function(e) {
        var msg = e.data;
        if (msg.command === 'scroll-preview') {
            lastSyncFromExtension = Date.now();
            var el = document.getElementById(msg.id);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } else if (msg.command === 'update-content') {
            // Preserve scroll position
            var savedScroll = contentArea.scrollTop;
            var savedHeading = activeId;

            // Update markdown content
            var mdBody = document.querySelector('.markdown-body');
            if (mdBody) { mdBody.innerHTML = msg.html; }

            // Update markdown source
            var sourceEl = document.getElementById('markdown-source');
            if (sourceEl) { sourceEl.textContent = msg.rawMarkdown; }

            document.body.classList.toggle('no-toc', !msg.tocItems || msg.tocItems.length === 0);
            updateBubblePosition();

            // Rebuild TOC
            headingLines = {};
            headingIds = [];
            msg.tocItems.forEach(function(item) {
                headingLines[item.id] = item.line;
                headingIds.push(item.id);
            });

            tocList.innerHTML = renderTOCTree(msg.tocTree);
            tocLinks = tocList.querySelectorAll('.toc-item > a');
            activeId = null;

            // Re-attach copy buttons and observer
            attachCopyButtons();
            setupMermaidToggles();
            if (observer) { observer.disconnect(); }
            if ('IntersectionObserver' in window && headingIds.length > 0) {
                observer = new IntersectionObserver(function() {
                    updateActiveHeading();
                }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
                headingIds.forEach(function(id) {
                    var el = document.getElementById(id);
                    if (el) { observer.observe(el); }
                });
            }

            // Restore scroll position
            contentArea.scrollTop = savedScroll;

            // Restore active heading highlight without triggering sync
            if (savedHeading) {
                tocLinks.forEach(function(link) {
                    var li = link.parentElement;
                    var isActive = link.getAttribute('href') === '#' + savedHeading;
                    li.classList.toggle('active', isActive);
                    if (isActive) { expandAncestors(li); }
                });
                activeId = savedHeading;
            }

            if (typeof __mermaidRender === 'function') {
                __mermaidRender();
            }
        }
    });

    function renderTOCTree(nodes) {
        return nodes.map(function(node) {
            var hasChildren = node.children && node.children.length > 0;
            var toggle = hasChildren ? '<span class="toc-toggle">\u25BC</span>' : '';
            var childrenHTML = hasChildren ? '<ul>' + renderTOCTree(node.children) + '</ul>' : '';
            return '<li class="toc-item toc-level-' + node.level + '">' +
                toggle + '<a href="#' + node.id + '" title="' + node.text + '">' + node.text + '</a>' +
                childrenHTML + '</li>';
        }).join('');
    }

    function copyText(text, onCopied) {
        function done() {
            if (onCopied) { onCopied(); }
        }

        function fallback() {
            if (vscodeApi) {
                vscodeApi.postMessage({ command: 'copy', text: text });
            }
            done();
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(fallback);
        } else {
            fallback();
        }
    }

    function getCodeText(pre) {
        var code = pre.querySelector('code');
        return code ? code.textContent || '' : pre.textContent || '';
    }

    // Rasterize a rendered mermaid <svg> into a PNG Blob at 2x for crisp output.
    function svgToPngBlob(svg) {
        return new Promise(function(resolve, reject) {
            var vb = svg.viewBox && svg.viewBox.baseVal;
            var rect = svg.getBoundingClientRect();
            var width = vb && vb.width ? vb.width : (rect.width || 800);
            var height = vb && vb.height ? vb.height : (rect.height || 600);
            var scale = 2;
            var clone = svg.cloneNode(true);
            if (!clone.getAttribute('viewBox')) {
                clone.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            }
            clone.setAttribute('width', width * scale);
            clone.setAttribute('height', height * scale);
            // Mermaid sets an inline max-width that would clamp the rasterized size.
            clone.style.maxWidth = 'none';
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
            var xml = new XMLSerializer().serializeToString(clone);
            var url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
            var img = new Image();
            img.onload = function() {
                try {
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(width * scale));
                    canvas.height = Math.max(1, Math.round(height * scale));
                    var ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    URL.revokeObjectURL(url);
                    canvas.toBlob(function(blob) {
                        if (blob) { resolve(blob); } else { reject(new Error('toBlob returned null')); }
                    }, 'image/png');
                } catch (err) {
                    URL.revokeObjectURL(url);
                    reject(err);
                }
            };
            img.onerror = function() {
                URL.revokeObjectURL(url);
                reject(new Error('SVG image failed to load'));
            };
            img.src = url;
        });
    }

    function markCodeButtonCopied(btn) {
        btn.innerHTML = checkIcon;
        btn.classList.add('copied');
        setTimeout(function() {
            btn.innerHTML = copyIcon;
            btn.classList.remove('copied');
        }, 2000);
    }

    function copyCodeFromPre(pre, showCopiedToast) {
        copyText(getCodeText(pre), function() {
            if (showCopiedToast) {
                showToast('Code copied to clipboard');
            }
        });
    }

    function attachCopyButtons() {
        document.querySelectorAll('.markdown-body pre').forEach(function(pre) {
            if (!pre.dataset.contextCopyAttached) {
                pre.dataset.contextCopyAttached = 'true';
                pre.addEventListener('contextmenu', function(e) {
                    // Mermaid source view uses the dedicated mermaid context menu instead.
                    if (pre.closest('.mermaid-block')) { return; }
                    e.preventDefault();
                    e.stopPropagation();
                    hideContextMenu();
                    copyCodeFromPre(pre, true);
                });
            }

            if (pre.querySelector('.copy-code-btn')) { return; }
            var btn = document.createElement('button');
            btn.className = 'copy-code-btn';
            btn.innerHTML = copyIcon;
            btn.title = 'Copy code';
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                copyText(getCodeText(pre), function() {
                    markCodeButtonCopied(btn);
                });
            });
            pre.appendChild(btn);
        });
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
    attachCopyButtons();

    // ====== Mermaid Toggle ======
    function setupMermaidToggles() {
        document.querySelectorAll('.mermaid-block').forEach(function(block) {
            if (block.dataset.mermaidToggleReady) { return; }
            block.dataset.mermaidToggleReady = '1';
            var graphEl = block.querySelector('.mermaid-graph');
            var contextEl = block.querySelector('.mermaid-context');
            var mermaidInner = graphEl ? graphEl.querySelector('.mermaid') : null;

            // ====== Mermaid Zoom ======
            var zoomLevel = 100;
            var panX = 0, panY = 0;

            // Zoom + pan are combined into a single transform on the inner element so
            // scaling is always applied to the rendered diagram, regardless of its size.
            // (CSS zoom on the container barely moves a large SVG sized with width:100%.)
            function applyMermaidTransform() {
                if (!mermaidInner) { return; }
                mermaidInner.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + (zoomLevel / 100) + ')';
            }

            function setMermaidZoom(next) {
                zoomLevel = Math.max(10, Math.min(300, Math.round(next / 10) * 10));
                applyMermaidTransform();
            }

            function resetMermaidView() {
                zoomLevel = 100;
                panX = 0;
                panY = 0;
                applyMermaidTransform();
            }

            // ====== Mermaid View Toggle (Graph / Source) ======
            function showGraph() {
                if (graphEl) { graphEl.style.display = ''; }
                if (contextEl) { contextEl.style.display = 'none'; }
                if (typeof __mermaidRender === 'function') { __mermaidRender(graphEl); }
            }

            function showSource() {
                if (graphEl) { graphEl.style.display = 'none'; }
                if (contextEl) { contextEl.style.display = ''; }
            }

            function isSourceView() {
                return !!(graphEl && graphEl.style.display === 'none');
            }

            // ====== Mermaid Context-Menu Actions ======
            function copyMermaidCode() {
                var pre = block.querySelector('.mermaid-context pre');
                var text = pre ? getCodeText(pre) : '';
                copyText(text, function() { showToast('Mermaid code copied to clipboard'); });
            }

            function copyMermaidPng() {
                var svg = block.querySelector('.mermaid-graph svg');
                if (!svg) { showToast('No diagram to copy'); return; }
                if (!(navigator.clipboard && navigator.clipboard.write) || typeof ClipboardItem === 'undefined') {
                    showToast('Copy PNG is not supported here');
                    return;
                }
                // Resolve the PNG blob first, then write a plain Blob. Passing a Promise
                // to ClipboardItem is not implemented in some Electron/Chromium versions.
                svgToPngBlob(svg).then(function(blob) {
                    return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                }).then(function() {
                    showToast('PNG copied to clipboard');
                }).catch(function() {
                    showToast('Copy PNG failed');
                });
            }

            block.__mermaidActions = {
                resetZoom: resetMermaidView,
                copyCode: copyMermaidCode,
                copyPng: copyMermaidPng,
                showGraph: showGraph,
                showSource: showSource,
                isSource: isSourceView
            };

            // Ctrl/Cmd + wheel zooms only this diagram, never the whole page.
            function onMermaidWheel(e) {
                if (!(e.ctrlKey || e.metaKey)) { return; }
                e.preventDefault();
                e.stopPropagation();
                setMermaidZoom(zoomLevel + (e.deltaY < 0 ? 10 : -10));
            }
            if (graphEl) { graphEl.addEventListener('wheel', onMermaidWheel, { passive: false }); }

            // ====== Mermaid Pan (hold left mouse button to drag) ======
            if (graphEl) {
                var isPanning = false;
                var panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;
                graphEl.addEventListener('mousedown', function(e) {
                    if (e.button !== 0) { return; }
                    isPanning = true;
                    panStartX = e.clientX;
                    panStartY = e.clientY;
                    panOriginX = panX;
                    panOriginY = panY;
                    graphEl.classList.add('panning');
                    e.preventDefault();
                });
                document.addEventListener('mousemove', function(e) {
                    if (!isPanning) { return; }
                    panX = panOriginX + (e.clientX - panStartX);
                    panY = panOriginY + (e.clientY - panStartY);
                    applyMermaidTransform();
                });
                document.addEventListener('mouseup', function() {
                    if (!isPanning) { return; }
                    isPanning = false;
                    graphEl.classList.remove('panning');
                });
            }
        });
    }
    setupMermaidToggles();

    // ====== Copy All ======
    function copyMarkdownSource() {
        var sourceEl = document.getElementById('markdown-source');
        var text = sourceEl ? sourceEl.textContent : '';
        copyText(text, function() {
            showToast('Markdown source copied to clipboard');
        });
    }

    // ====== Theme Switch ======
    var themes = ['light', 'dark', 'default'];
    var themeLabels = ['Light', 'Dark', 'System'];
    var initialTheme = '${this.jsonEscape(initialTheme)}';
    var currentTheme = themes.indexOf(initialTheme);
    if (currentTheme < 0) { currentTheme = 0; }

    function applyTheme(theme) {
        if (theme === 'default') {
            document.body.removeAttribute('data-theme');
        } else {
            document.body.setAttribute('data-theme', theme);
        }
    }

    function cycleTheme() {
        currentTheme = (currentTheme + 1) % themes.length;
        var theme = themes[currentTheme];
        applyTheme(theme);
        if (vscodeApi) { vscodeApi.postMessage({ command: 'set-theme', theme: theme }); }
        showToast('Theme: ' + themeLabels[currentTheme]);
    }

    applyTheme(themes[currentTheme]);

    // ====== Refresh ======
    function refreshPreview() {
        if (vscodeApi) {
            vscodeApi.postMessage({ command: 'refresh' });
        }
    }

    // ====== Zoom ======
    var zoomLevel = 100;
    var markdownBody = document.querySelector('.markdown-body');
    var zoomIndicator = document.getElementById('zoom-indicator');
    var zoomIndicatorTimer;

    function showZoomIndicator() {
        if (!zoomIndicator) { return; }
        zoomIndicator.textContent = zoomLevel + '%';
        var rect = contentArea.getBoundingClientRect();
        zoomIndicator.style.left = (rect.left + rect.width / 2) + 'px';
        zoomIndicator.style.top = (rect.top + rect.height / 2) + 'px';
        zoomIndicator.classList.add('show');
        clearTimeout(zoomIndicatorTimer);
        zoomIndicatorTimer = setTimeout(function() {
            zoomIndicator.classList.remove('show');
        }, 1000);
    }

    function applyZoom() {
        if (!markdownBody) { return; }
        markdownBody.style.fontSize = zoomLevel + '%';
    }

    function resetZoom() {
        zoomLevel = 100;
        applyZoom();
    }

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
            showZoomIndicator();
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

    if (typeof __mermaidRender === 'function') {
        __mermaidRender();
    }
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
