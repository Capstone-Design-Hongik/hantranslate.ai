/**
 * DOM에서 번역 대상 텍스트를 블록 단위로 추출하는 모듈.
 *
 * 핵심 설계:
 * - 블록 요소(p, li, h1-h6 등) 단위로 추출하여 문장이 잘리는 문제 방지
 * - 중첩된 블록이 있으면 가장 안쪽(leaf) 블록만 추출하여 중복 번역 방지
 *   예: <blockquote><p>text</p></blockquote>에서 <blockquote>는 제외하고 <p>만 추출
 *
 * @module domExtractor
 */

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
 * {@link extractTranslatableContents}에서 채워지며, {@link getExtractedBlocks}를 통해 접근한다.
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
 * 다른 블록을 포함하는 블록(non-leaf) 집합을 찾는다.
 * non-leaf 블록의 innerHTML은 자식 블록을 포함하므로 번역 시 중복이 발생한다.
 *
 * querySelectorAll이 반환하는 NodeList는 DFS 전위 순회 순서로 정렬되어 있다.
 * 이 특성을 이용하여 스택 기반으로 단일 순회만으로 부모-자식 관계를 파악한다.
 *
 * @param allBlocks - querySelectorAll로 추출한 블록 요소들 (문서 순서)
 * @returns 다른 블록을 포함하는 블록 집합
 */
function findNonLeafBlocks(allBlocks: NodeListOf<Element>): Set<Element> {
  const nonLeafBlocks = new Set<Element>();
  const stack: Element[] = [];

  for (const el of allBlocks) {
    // 스택 상단이 현재 요소를 포함하지 않으면 범위가 끝난 것이므로 pop
    while (stack.length > 0 && !stack[stack.length - 1].contains(el)) {
      stack.pop();
    }

    // 스택에 남은 요소가 있으면 그 요소는 현재 요소의 조상 (non-leaf)
    if (stack.length > 0) {
      nonLeafBlocks.add(stack[stack.length - 1]);
    }

    // 현재 요소를 스택에 추가하여 자손 블록 탐지 대기
    stack.push(el);
  }

  return nonLeafBlocks;
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
export function extractTranslatableContents(): string[] {
  extractedBlocks = [];
  const texts: string[] = [];

  const blocks = document.querySelectorAll(BLOCK_SELECTORS.join(", "));

  // 다른 블록을 포함하는 블록(non-leaf)을 미리 계산
  const nonLeafBlocks = findNonLeafBlocks(blocks);

  for (const block of blocks) {
    // 제외 대상 확인 (조상에 skip 요소가 있는지)
    if (shouldSkip(block)) continue;

    // non-leaf 블록 제외: innerHTML에 자식 블록이 포함되어 중복 번역됨
    // 예: <blockquote><p>text</p></blockquote>에서 <blockquote>는 제외
    if (nonLeafBlocks.has(block)) continue;

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
 * {@link extractTranslatableContents} 호출 시 저장된 요소 참조를 반환하며,
 * 번역된 HTML로 DOM을 교체할 때 사용된다.
 *
 * @returns 추출된 Element 배열. {@link extractTranslatableContents}가 호출되지 않았으면 빈 배열.
 */
export function getExtractedBlocks(): Element[] {
  return extractedBlocks;
}
