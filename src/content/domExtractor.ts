/**
 * 번역 대상 블록 요소 선택자.
 * 텍스트 콘텐츠를 담는 블록 레벨 요소들을 대상으로 한다.
 */
const BLOCK_SELECTORS = [
  "p",
  "li",
  "td",
  "th",
  "dt",
  "dd",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "figcaption",
];

/**
 * 번역에서 제외할 요소/조상 선택자.
 * 스크립트, 스타일, 코드 블록 등 번역하면 안 되는 기술적 콘텐츠를 필터링한다.
 */
const SKIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "pre",
  "textarea",
  "input",
  "svg",
  "math",
  "[data-no-translate]",
];

/**
 * 추출된 블록 요소 참조를 저장하는 배열.
 * {@link extractTextNodes}에서 채워지며, {@link getExtractedBlocks}를 통해 접근한다.
 * 번역 후 DOM 교체 시 원본 요소 참조로 사용된다.
 */
let extractedBlocks: Element[] = [];

/**
 * 제외 대상 여부 확인.
 * 요소 자체 또는 조상 요소가 SKIP_SELECTORS에 해당하는지 검사한다.
 *
 * @param element - 검사할 요소
 * @returns 제외 대상이면 true
 */
function shouldSkip(element: Element): boolean {
  return SKIP_SELECTORS.some((sel) => element.closest(sel) !== null);
}

/**
 * 블록 자손이 있는지 확인 (중복 추출 방지).
 * 예: `<blockquote><p>text</p></blockquote>`에서 `<p>`만 추출하고 `<blockquote>`는 건너뛴다.
 *
 * @param element - 검사할 요소
 * @param allBlocks - 모든 블록 요소 목록
 * @returns 이 요소가 다른 블록을 포함하면 true (가장 안쪽 블록만 추출하기 위해)
 */
function hasBlockDescendant(
  element: Element,
  allBlocks: NodeListOf<Element>,
): boolean {
  for (const block of allBlocks) {
    if (block !== element && element.contains(block)) {
      return true;
    }
  }
  return false;
}

/**
 * DOM에서 번역 대상 블록 요소를 추출한다.
 *
 * 블록 요소(p, li, h1-h6 등)를 단위로 추출하여 문장 분리 문제를 해결한다.
 * innerHTML을 사용하여 인라인 태그(strong, em 등)를 보존한다.
 *
 * @returns 추출된 HTML 문자열 배열. 각 요소는 블록의 innerHTML이다.
 *
 * @example
 * // <p>Hello <strong>world</strong>!</p>
 * // 위 HTML에서 추출 결과: ["Hello <strong>world</strong>!"]
 *
 * @sideeffect {@link extractedBlocks} 배열을 초기화하고 추출된 요소 참조로 채운다.
 */
export function extractTextNodes(): string[] {
  extractedBlocks = [];
  const texts: string[] = [];

  const blocks = document.querySelectorAll(BLOCK_SELECTORS.join(", "));

  for (const block of blocks) {
    // 제외 대상 확인 (조상에 skip 요소가 있는지)
    if (shouldSkip(block)) continue;

    // 중첩된 블록 제외 (예: <blockquote> 안의 <p>는 <p>만 처리)
    // 자손 블록이 있으면 건너뛰어 가장 안쪽 블록만 추출
    if (hasBlockDescendant(block, blocks)) continue;

    // 빈 텍스트 제외 (태그만 있는 경우도 체크)
    if (!block.textContent?.trim()) continue;

    // 블록의 innerHTML 추출 (인라인 태그 보존)
    const html = block.innerHTML;

    extractedBlocks.push(block);
    texts.push(html);
  }

  return texts;
}

/**
 * 가장 최근에 추출된 블록 요소 참조 배열을 반환한다.
 *
 * {@link extractTextNodes} 호출 시 저장된 요소 참조를 반환하며,
 * 번역된 HTML로 DOM을 교체할 때 사용된다.
 *
 * @returns 추출된 Element 배열. {@link extractTextNodes}가 호출되지 않았으면 빈 배열.
 */
export function getExtractedBlocks(): Element[] {
  return extractedBlocks;
}
