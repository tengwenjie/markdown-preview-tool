import * as vscode from 'vscode';
import { MarkdownPreviewPanel } from './preview-panel';

export function activate(context: vscode.ExtensionContext) {
    const showPreview = vscode.commands.registerCommand(
        'markdown-preview-tool.showPreview',
        () => {
            MarkdownPreviewPanel.createOrShow(context.extensionUri);
        }
    );

    const showPreviewToSide = vscode.commands.registerCommand(
        'markdown-preview-tool.showPreviewToSide',
        () => {
            MarkdownPreviewPanel.createOrShow(
                context.extensionUri,
                vscode.ViewColumn.Beside
            );
        }
    );

    const onDidChangeEditor = vscode.window.onDidChangeActiveTextEditor(
        (editor) => {
            if (
                editor &&
                editor.document.languageId === 'markdown' &&
                MarkdownPreviewPanel.currentPanel
            ) {
                MarkdownPreviewPanel.currentPanel.update(
                    editor.document.getText(),
                    editor.document.fileName,
                    true
                );
            }
        }
    );

    const onDidChangeDocument = vscode.workspace.onDidChangeTextDocument((e) => {
        const editor = vscode.window.activeTextEditor;
        if (
            editor &&
            e.document === editor.document &&
            editor.document.languageId === 'markdown' &&
            MarkdownPreviewPanel.currentPanel
        ) {
            MarkdownPreviewPanel.currentPanel.update(
                editor.document.getText(),
                editor.document.fileName
            );
        }
    });

    context.subscriptions.push(
        showPreview,
        showPreviewToSide,
        onDidChangeEditor,
        onDidChangeDocument
    );
}

export function deactivate() {}
