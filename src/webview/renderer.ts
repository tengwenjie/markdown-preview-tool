import mermaid from 'mermaid';

mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
});

async function renderMermaidDiagrams(): Promise<void> {
    const elements = document.querySelectorAll<HTMLElement>('.mermaid');
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
