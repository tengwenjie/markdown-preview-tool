import mermaid from 'mermaid';

mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
});

async function renderMermaidDiagrams(container?: HTMLElement): Promise<void> {
    const root: HTMLElement | Document = container || document;
    const elements = root.querySelectorAll<HTMLElement>('.mermaid');
    if (elements.length === 0) {
        return;
    }
    try {
        await mermaid.run({ nodes: Array.from(elements) });
    } catch {
        // silently ignore mermaid rendering errors
    }
}

(window as any).__mermaidRender = renderMermaidDiagrams;
