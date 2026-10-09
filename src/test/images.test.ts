import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as http from 'http';
import * as vm from 'vm';
import * as vscode from 'vscode';
import MarkdownIt = require('markdown-it');
import { MarkdownPreviewPanel } from '../preview-panel';

interface ImageHarness {
    currentFile: string;
    panel: { webview: { asWebviewUri(uri: vscode.Uri): vscode.Uri; postMessage(message: unknown): Promise<boolean> } };
    extensionUri: vscode.Uri;
    md: MarkdownIt;
    imageSources: Map<string, string>;
    createMarkdownIt(): MarkdownIt;
    collectResourceDirs(markdown: string): string[];
    handleImageAction(message: { command: string; src: string; requestId?: number }): Promise<void>;
    getWebviewContent(html: string, tocTree: unknown[], tocItems: unknown[], filename: string, markdown: string, theme: string): string;
}

suite('Preview images', () => {
    let preview: ImageHarness;
    let resources: vscode.Uri[];
    let messages: Array<{ command: string; requestId?: number; data?: string; mime?: string; error?: string }>;
    const baseDir = vscode.Uri.file(path.resolve('image-tests', 'docs')).fsPath;

    setup(() => {
        resources = [];
        messages = [];
        preview = Object.create(MarkdownPreviewPanel.prototype) as ImageHarness;
        preview.currentFile = path.join(baseDir, 'example.md');
        preview.imageSources = new Map();
        preview.extensionUri = vscode.Uri.file(baseDir);
        preview.panel = {
            webview: {
                asWebviewUri(uri) {
                    resources.push(uri);
                    return uri.with({ scheme: 'https', authority: 'images.test' });
                },
                async postMessage(message) {
                    messages.push(message as typeof messages[number]);
                    return true;
                },
            },
        };
        preview.md = preview.createMarkdownIt();
    });

    test('rewrites relative Markdown and quoted/unquoted HTML image sources', () => {
        for (const markdown of [
            '![picture](./assets/picture.png)',
            '<img src="./assets/picture.png" width="100">',
            "<img src='./assets/picture.png'>",
            '<img src=./assets/picture.png>',
            '<img alt="a > b" src=./assets/picture.png>',
        ]) {
            const html = preview.md.render(markdown);
            assert.ok(html.includes('https://images.test/'), html);
            assert.strictEqual(resources.at(-1)?.fsPath, path.join(baseDir, 'assets', 'picture.png'));
        }
    });

    test('collects directories from reference images outside default roots', () => {
        const markdown = '![picture][asset]\n\n[asset]: ../../../shared/picture.png';
        const dirs = preview.collectResourceDirs(markdown);
        preview.md.render(markdown);
        assert.deepStrictEqual(dirs, [path.resolve(baseDir, '../../../shared')]);
        assert.strictEqual(path.dirname(resources[0].fsPath), dirs[0]);
    });

    test('supports encoded paths, absolute paths and file URIs', () => {
        const target = path.join(baseDir, 'assets', '图片 one.png');
        for (const source of [
            './assets/%E5%9B%BE%E7%89%87%20one.png',
            target,
            vscode.Uri.file(target).toString(),
        ]) {
            preview.md.render(`<img src="${source}">`);
            assert.strictEqual(resources.at(-1)?.fsPath, target);
        }
        preview.md.render(`![picture](${vscode.Uri.file(target).toString()})`);
        assert.strictEqual(resources.at(-1)?.fsPath, target);
    });

    test('decodes HTML entities and preserves SVG fragments and query strings', () => {
        preview.md.render('<img src="./assets/picture.svg?v=1&amp;size=2#icon">');
        assert.strictEqual(resources[0].fsPath, path.join(baseDir, 'assets', 'picture.svg'));
        assert.strictEqual(resources[0].query, 'v=1&size=2');
        assert.strictEqual(resources[0].fragment, 'icon');
    });

    test('preserves remote/data sources and resolves protocol-relative URLs', () => {
        const sources = ['https://example.com/picture.png', 'http://example.com/picture.png', 'data:image/png;base64,aGVsbG8='];
        for (const source of sources) {
            assert.ok(preview.md.render(`<img src="${source}">`).includes(source));
        }
        assert.ok(preview.md.render('<img src="//example.com/picture.png">').includes('https://example.com/picture.png'));
        assert.deepStrictEqual(resources, []);
    });

    test('does not interpret data-src, other attributes or code as image sources', () => {
        const markdown = '<img data-src="missing.png" alt="src=missing.png" src="./assets/picture.png">';
        const html = preview.md.render(markdown);
        assert.ok(html.includes('data-src="missing.png"'));
        assert.ok(html.includes('alt="src=missing.png"'));
        assert.strictEqual(resources.length, 1);
        assert.deepStrictEqual(preview.collectResourceDirs('```html\n<img src="../../../outside/a.png">\n```'), []);
    });

    test('loads the original local image bytes for copying and saving', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-image-'));
        try {
            const file = path.join(dir, 'original.png');
            const bytes = Buffer.from('image-content');
            await fs.writeFile(file, bytes);
            preview.md.render(`<img src="${file}">`);
            const src = [...preview.imageSources.keys()][0];
            await preview.handleImageAction({ command: 'load-image', src, requestId: 7 });
            assert.strictEqual(messages[0].requestId, 7);
            assert.strictEqual(messages[0].mime, 'image/png');
            assert.deepStrictEqual(Buffer.from(messages[0].data!, 'base64'), bytes);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    test('loads data URI images without treating them as local files', async () => {
        const src = 'data:image/png;base64,aGVsbG8=';
        preview.md.render(`<img src="${src}">`);
        await preview.handleImageAction({ command: 'load-image', src, requestId: 8 });
        assert.strictEqual(messages[0].data, 'aGVsbG8=');
        assert.strictEqual(messages[0].mime, 'image/png');
    });

    test('loads remote images through the extension and reports HTTP errors', async () => {
        const server = http.createServer((request, response) => {
            if (request.url === '/missing') {
                response.writeHead(404).end();
            } else {
                response.writeHead(200, { 'Content-Type': 'image/jpeg' }).end('remote-image');
            }
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            const port = (server.address() as import('net').AddressInfo).port;
            const src = `http://127.0.0.1:${port}/image`;
            preview.md.render(`<img src="${src}">`);
            await preview.handleImageAction({ command: 'load-image', src });
            assert.strictEqual(messages[0].mime, 'image/jpeg');
            assert.strictEqual(Buffer.from(messages[0].data!, 'base64').toString(), 'remote-image');
            const missing = `http://127.0.0.1:${port}/missing`;
            preview.md.render(`<img src="${missing}">`);
            await preview.handleImageAction({ command: 'load-image', src: missing });
            assert.ok(messages[1].error?.includes('404'));
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
    });

    test('rejects requests for sources that are not rendered in the preview', async () => {
        await preview.handleImageAction({ command: 'load-image', src: 'file:///not-rendered.png', requestId: 9 });
        assert.strictEqual(messages[0].command, 'image-data');
        assert.strictEqual(messages[0].requestId, 9);
        assert.ok(messages[0].error);
        assert.strictEqual(messages[0].data, undefined);
    });

    test('generates valid webview JavaScript with the image menu', async () => {
        const html = preview.getWebviewContent('<img src="picture.png">', [], [], 'test.md', '', 'light');
        for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
            assert.doesNotThrow(() => new vm.Script(match[1]));
        }
        // Keep an actual generated preview for the browser interaction check.
        await fs.mkdir(path.resolve(__dirname, '../browser-check'), { recursive: true });
        await fs.writeFile(path.resolve(__dirname, '../browser-check/preview.html'), html);
    });
});
