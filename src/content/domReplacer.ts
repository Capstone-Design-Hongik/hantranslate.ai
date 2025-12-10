import { getExtractedNodes } from "./domExtractor";

export function replaceTextNodes(
  replacements: Array<{ index: number; text: string }>,
): void {
  const nodes = getExtractedNodes();

  for (const { index, text } of replacements) {
    const node = nodes[index];
    if (node) {
      node.textContent = text;
    }
  }
}
