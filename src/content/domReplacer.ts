import { getExtractedBlocks } from "./domExtractor";

/**
 * 번역된 HTML로 블록 요소를 교체한다.
 *
 * 인덱스 기반 교체 방식을 유지하며, innerHTML로 교체하여 인라인 태그를 보존한다.
 *
 * @param replacements - 교체할 번역 데이터 배열
 * @param replacements[].index - 교체할 블록의 인덱스 (extractTextNodes 반환 배열의 인덱스와 동일)
 * @param replacements[].text - 번역된 HTML 문자열
 */
export function replaceTextNodes(
  replacements: Array<{ index: number; text: string }>,
): void {
  const blocks = getExtractedBlocks();

  for (const { index, text } of replacements) {
    const block = blocks[index];
    if (block) {
      block.innerHTML = text;
    }
  }
}
