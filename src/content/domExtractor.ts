const EXCLUDED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "CODE",
  "PRE",
  "TEXTAREA",
  "INPUT",
  "SVG",
  "MATH",
]);

// 추출된 텍스트 노드 참조 저장 (교체 시 사용)
let extractedNodes: Text[] = [];

export function extractTextNodes(): string[] {
  extractedNodes = [];
  const texts: string[] = [];

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (EXCLUDED_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let node: Text | null;
  while ((node = walker.nextNode() as Text)) {
    extractedNodes.push(node);
    texts.push(node.textContent || "");
  }

  return texts;
}

export function getExtractedNodes(): Text[] {
  return extractedNodes;
}
