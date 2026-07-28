import mermaid from 'mermaid';

mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    // Render labels as native SVG <text> instead of <foreignObject> HTML.
    // foreignObject taints the canvas, which blocks exporting the diagram as PNG.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
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
