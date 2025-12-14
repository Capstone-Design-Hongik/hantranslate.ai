# DOM Extractor 개선 계획 v2

> **이전 문서 검토 결과 반영**
> - [PLAN_REFACTOR_DOM_EXTRACTOR.md](PLAN_REFACTOR_DOM_EXTRACTOR.md): 진단 보고서 (문제 정의)
> - [PLAN_EXTRACTION_STRATEGY.md](PLAN_EXTRACTION_STRATEGY.md): Strategy Pattern 설계 (Phase 4 참조용)

---

## 1. 계획 수정 배경

### 1.1 기존 계획의 문제점

PLAN_EXTRACTION_STRATEGY는 Strategy Pattern + Registry + Context + TestHarness를 포함한 범용 아키텍처를 제안했으나:

| 문제 | 설명 |
|------|------|
| YAGNI 위반 | 현재 전략이 1개뿐인데 교체 인프라 구축은 시기상조 |
| 과도한 추상화 | ~1000줄 설계로 MVP 복잡도 증가 |
| 핵심 문제 우회 | 패턴 설계에 집중하여 실제 문제 해결 지연 |

### 1.2 수정된 접근법

**"동작하는 코드 먼저, 패턴 나중"** + **점진적 개선**

```
AS-IS: 설계 문서 → Strategy Pattern 구현 → 전략 실험
TO-BE: 문장 분리 해결 → placeholder 추가 → 인터페이스 정규화 → 필요시 패턴 도입
```

---

## 2. 핵심 문제 정의

### 2.1 현재 상태

```typescript
// domExtractor.ts (현재)
const EXCLUDED_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", // ← CODE가 포함됨
  "TEXTAREA", "INPUT", "SVG", "MATH",
]);
```

- Text 노드 단위 추출 → 문장 분리 발생
- 모든 `<code>` 제외 → 인라인 코드도 누락

### 2.2 해결해야 할 문제 (우선순위 순)

| 순서 | 문제 | 입력 | 현재 결과 | 기대 결과 | Phase |
|------|------|------|-----------|-----------|-------|
| 1 | 문장 분리 | `<p>Hello <strong>world</strong>!</p>` | `["Hello ", "world", "!"]` | `"Hello <strong>world</strong>!"` | **Phase 1** |
| 2 | 인라인 코드 누락 | `<p>Use <code>npm</code> to install</p>` | `["Use ", " to install"]` | `"Use {{CODE_0}} to install"` + placeholder | Phase 2 |
| 3 | 멀티라인 코드 포함 | `<pre><code>...</code></pre>` | 제외됨 ✅ | 제외 유지 ✅ | - |

> **참고**: Translator API는 HTML 태그를 보존하므로, Phase 1에서 `innerHTML`을 사용하여 마크업 손실 없이 번역할 수 있습니다.

---

## 3. 구현 계획

### Phase 1: 문장 분리 문제 해결 (최소 변경)

**목표**: 인라인 태그로 인해 텍스트가 분리되는 문제만 해결
**인터페이스 변경**: 없음 (기존 `extractTextNodes()` 유지)

#### 3.1 블록 요소 기반 추출

```typescript
// content/domExtractor.ts 수정

/**
 * 번역 대상 블록 요소 선택자
 * - 텍스트 콘텐츠를 담는 블록 레벨 요소들
 */
const BLOCK_SELECTORS = [
  'p', 'li', 'td', 'th', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'figcaption',
];

/**
 * 번역에서 제외할 요소/조상 선택자
 */
const SKIP_SELECTORS = [
  'script', 'style', 'noscript', 'pre',
  'textarea', 'input', 'svg', 'math',
  '[data-no-translate]',
];

// 블록 요소 참조 저장 (교체 시 사용)
let extractedBlocks: Element[] = [];

/**
 * 블록 요소 기반 텍스트 추출
 * - 기존 extractTextNodes()와 동일한 인터페이스 유지
 * - 내부적으로 블록 단위로 추출하여 문장 분리 방지
 * - innerHTML 사용으로 인라인 태그 보존 (Translator API가 처리)
 */
export function extractTextNodes(): string[] {
  extractedBlocks = [];
  const texts: string[] = [];

  const blocks = document.querySelectorAll(BLOCK_SELECTORS.join(', '));

  for (const block of blocks) {
    // 제외 대상 확인 (조상에 skip 요소가 있는지)
    if (shouldSkip(block)) continue;

    // 중첩된 블록 제외 (예: <li> 안의 <p>는 <p>만 처리)
    if (hasBlockAncestor(block, blocks)) continue;

    // 블록의 innerHTML 추출 (인라인 태그 보존)
    const html = block.innerHTML;

    // 빈 텍스트 제외 (태그만 있는 경우도 체크)
    if (!block.textContent?.trim()) continue;

    extractedBlocks.push(block);
    texts.push(html);
  }

  return texts;
}

/**
 * 제외 대상 여부 확인
 */
function shouldSkip(element: Element): boolean {
  return SKIP_SELECTORS.some(sel => element.closest(sel) !== null);
}

/**
 * 블록 조상이 있는지 확인 (중복 추출 방지)
 */
function hasBlockAncestor(element: Element, allBlocks: NodeListOf<Element>): boolean {
  for (const block of allBlocks) {
    if (block !== element && block.contains(element)) {
      return true;
    }
  }
  return false;
}

/**
 * 추출된 블록 요소 배열 반환
 */
export function getExtractedBlocks(): Element[] {
  return extractedBlocks;
}
```

#### 3.2 DOM 교체 로직 수정

```typescript
// content/domReplacer.ts 수정

import { getExtractedBlocks } from './domExtractor';

/**
 * 번역된 HTML로 블록 요소 교체
 * - 인덱스 기반 교체 방식 유지
 * - innerHTML로 교체하여 인라인 태그 보존
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
```

#### 3.3 Phase 1 특징

- **마크업 보존**: Translator API가 HTML 태그를 보존하므로 `<strong>`, `<em>` 등 인라인 태그 유지
- **한계**: 인라인 `<code>` 텍스트도 번역됨 → Phase 2에서 placeholder로 보호

---

### Phase 2: 인라인 코드 Placeholder 처리

**목표**: 인라인 `<code>` 태그를 placeholder로 치환하여 번역에서 보호

#### 3.4 멀티라인 코드블럭 판별

```typescript
// content/domExtractor.ts에 추가

/**
 * 멀티라인 코드블럭 여부 판별
 * - <pre> 태그
 * - <pre> 내부의 <code>
 * - language-* 또는 hljs 클래스를 가진 <code>
 */
function isMultilineCodeBlock(element: Element): boolean {
  if (element.tagName === 'PRE') return true;

  if (element.tagName === 'CODE') {
    // <pre> 내부의 <code>
    if (element.closest('pre')) return true;

    // 코드 하이라이팅 클래스
    const classList = element.classList;
    if (classList.contains('hljs')) return true;
    if ([...classList].some(c => c.startsWith('language-'))) return true;
  }

  return false;
}
```

#### 3.5 Placeholder 처리

```typescript
// content/domExtractor.ts에 추가

interface PlaceholderMap {
  token: string;      // "{{CODE_0}}"
  html: string;       // "<code>npm</code>"
}

interface TranslationUnit {
  id: string;
  element: Element;
  originalHTML: string;
  textForTranslation: string;
  placeholders: PlaceholderMap[];
}

let extractedUnits: TranslationUnit[] = [];

/**
 * 블록 요소 기반 번역 단위 추출 (placeholder 포함)
 */
export function extractTranslationUnits(): TranslationUnit[] {
  extractedUnits = [];

  const blocks = document.querySelectorAll(BLOCK_SELECTORS.join(', '));
  let index = 0;

  for (const block of blocks) {
    if (shouldSkip(block)) continue;
    if (hasBlockAncestor(block, blocks)) continue;

    const { text, placeholders } = processInlineElements(block, index);

    if (!text.trim()) continue;

    extractedUnits.push({
      id: `unit-${index}`,
      element: block,
      originalHTML: block.innerHTML,
      textForTranslation: text,
      placeholders,
    });

    index++;
  }

  return extractedUnits;
}

/**
 * 인라인 <code>를 placeholder로 치환
 */
function processInlineElements(
  block: Element,
  blockIndex: number
): { text: string; placeholders: PlaceholderMap[] } {
  const placeholders: PlaceholderMap[] = [];
  let html = block.innerHTML;
  let counter = 0;

  // 인라인 <code> 치환 (멀티라인 코드블럭 제외)
  html = html.replace(
    /<code(?![^>]*(?:class=["'][^"']*(?:language-|hljs)))[^>]*>([\s\S]*?)<\/code>/gi,
    (match) => {
      const token = `{{CODE_${blockIndex}_${counter++}}}`;
      placeholders.push({ token, html: match });
      return token;
    }
  );

  // HTML 태그 제거하여 순수 텍스트 추출
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  const text = tempDiv.textContent || '';

  return { text, placeholders };
}
```

#### 3.6 번역 결과 적용

```typescript
/**
 * 번역 결과를 DOM에 적용 (placeholder 복원)
 */
export function applyTranslations(
  translations: Array<{ id: string; translatedText: string }>
): void {
  for (const { id, translatedText } of translations) {
    const unit = extractedUnits.find(u => u.id === id);
    if (!unit) continue;

    // Placeholder 복원
    let finalHTML = translatedText;
    for (const { token, html } of unit.placeholders) {
      finalHTML = finalHTML.replace(token, html);
    }

    // DOM 교체
    unit.element.innerHTML = finalHTML;
  }
}

/**
 * 원문 복원
 */
export function restoreOriginal(): void {
  for (const unit of extractedUnits) {
    unit.element.innerHTML = unit.originalHTML;
  }
}
```

---

### Phase 3: 인터페이스 정규화

Phase 2 완료 후 안정화되면:

1. **새 메시지 타입 추가**
   - `GET_TRANSLATION_UNITS`, `APPLY_TRANSLATIONS`, `RESTORE_ORIGINAL`
   - 레거시 호환 유지

2. **레거시 메시지 타입 제거**
   - `GET_TEXT_NODES`, `REPLACE_TEXT` 제거
   - `TEXT_NODES`, `REPLACE_DONE` 제거

3. **추가 인라인 요소 지원**
   - `<a>` 링크 보존
   - `<strong>`, `<em>` 강조 보존

4. **에러 처리 강화**
   - Placeholder 복원 실패 시 원문 유지
   - 번역 실패 시 부분 적용

---

### Phase 4: Strategy Pattern 도입 (확장시)

**도입 조건:**
- 실제로 여러 추출 전략이 필요해졌을 때
- 사이트별로 다른 전략이 필요함이 검증되었을 때

**참조 문서:** [PLAN_EXTRACTION_STRATEGY.md](PLAN_EXTRACTION_STRATEGY.md)
- ExtractionStrategy 인터페이스
- StrategyRegistry 싱글톤
- ExtractionContext 실행기
- StrategyTestHarness 비교 도구

---

## 4. 파일 변경 계획

### 4.1 Phase 1 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `content/domExtractor.ts` | 블록 기반 추출 로직으로 교체 (인터페이스 유지) |
| `content/domReplacer.ts` | `getExtractedBlocks()` 사용하도록 수정 |

### 4.2 Phase 2 추가 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `content/domExtractor.ts` | placeholder 처리 함수 추가 |
| `content/index.ts` | 새 메시지 타입 핸들러 추가 |
| `shared/messages.ts` | 새 메시지 타입 추가 |
| `background/messageHandler.ts` | 새 메시지 타입 처리 |

---

## 5. 테스트 케이스

### 5.1 Phase 1 테스트

```typescript
describe('Phase 1: extractTextNodes (블록 기반)', () => {
  it('블록 요소의 innerHTML을 추출', () => {
    document.body.innerHTML = '<p>Hello <strong>world</strong>!</p>';
    const texts = extractTextNodes();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe('Hello <strong>world</strong>!');
  });

  it('여러 블록 요소를 각각 추출', () => {
    document.body.innerHTML = '<p>First</p><p>Second</p>';
    const texts = extractTextNodes();
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe('First');
    expect(texts[1]).toBe('Second');
  });

  it('중첩된 블록은 내부만 추출', () => {
    document.body.innerHTML = '<blockquote><p>Quote text</p></blockquote>';
    const texts = extractTextNodes();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe('Quote text');
  });

  it('pre 태그 내용은 제외', () => {
    document.body.innerHTML = '<pre><code>const x = 1;</code></pre><p>Hello</p>';
    const texts = extractTextNodes();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe('Hello');
  });

  it('빈 블록은 제외', () => {
    document.body.innerHTML = '<p>   </p><p>Hello</p>';
    const texts = extractTextNodes();
    expect(texts).toHaveLength(1);
  });

  it('인라인 코드도 포함하여 추출', () => {
    document.body.innerHTML = '<p>Use <code>npm</code> to install</p>';
    const texts = extractTextNodes();
    expect(texts[0]).toBe('Use <code>npm</code> to install');
  });
});

describe('Phase 1: replaceTextNodes', () => {
  it('번역된 HTML로 교체 (인라인 태그 보존)', () => {
    document.body.innerHTML = '<p>Hello <strong>world</strong>!</p>';
    extractTextNodes();
    replaceTextNodes([{ index: 0, text: '안녕 <strong>세계</strong>!' }]);
    expect(document.querySelector('p')?.innerHTML).toBe('안녕 <strong>세계</strong>!');
  });
});
```

### 5.2 Phase 2 테스트

```typescript
describe('Phase 2: extractTranslationUnits', () => {
  it('인라인 코드를 placeholder로 치환', () => {
    document.body.innerHTML = '<p>Use <code>npm</code> to install</p>';
    const units = extractTranslationUnits();
    expect(units[0].textForTranslation).toMatch(/Use \{\{CODE_\d+_\d+\}\} to install/);
    expect(units[0].placeholders).toHaveLength(1);
  });

  it('멀티라인 코드블럭은 제외', () => {
    document.body.innerHTML = '<pre><code>const x = 1;</code></pre><p>Hello</p>';
    const units = extractTranslationUnits();
    expect(units).toHaveLength(1);
    expect(units[0].textForTranslation).toBe('Hello');
  });

  it('language-* 클래스 코드는 placeholder 없이 제외', () => {
    document.body.innerHTML = '<p>Code: <code class="language-js">const x</code></p>';
    const units = extractTranslationUnits();
    // language-js 코드는 placeholder로 치환되지 않음 (이미 제외됨)
  });
});

describe('Phase 2: applyTranslations', () => {
  it('placeholder를 복원하여 적용', () => {
    document.body.innerHTML = '<p>Use <code>npm</code> to install</p>';
    extractTranslationUnits();

    applyTranslations([{
      id: 'unit-0',
      translatedText: '{{CODE_0_0}}을 사용하여 설치하세요'
    }]);

    expect(document.body.innerHTML).toContain('<code>npm</code>');
    expect(document.body.innerHTML).toContain('설치하세요');
  });
});

describe('Phase 2: restoreOriginal', () => {
  it('원문으로 복원', () => {
    const originalHTML = '<p>Use <code>npm</code> to install</p>';
    document.body.innerHTML = originalHTML;

    extractTranslationUnits();
    applyTranslations([{ id: 'unit-0', translatedText: '번역됨' }]);
    restoreOriginal();

    expect(document.querySelector('p')?.innerHTML).toBe('Use <code>npm</code> to install');
  });
});
```

---

## 6. 체크리스트

### Phase 1 완료 조건

- [ ] `extractTextNodes()` 블록 기반으로 수정
- [ ] `shouldSkip()` 구현
- [ ] `hasBlockAncestor()` 구현
- [ ] `getExtractedBlocks()` 추가
- [ ] `replaceTextNodes()` 블록 교체로 수정
- [ ] Phase 1 테스트 케이스 통과
- [ ] example.html에서 동작 검증

### Phase 2 완료 조건

- [ ] `isMultilineCodeBlock()` 구현
- [ ] `processInlineElements()` 구현
- [ ] `extractTranslationUnits()` 구현
- [ ] `applyTranslations()` 구현
- [ ] `restoreOriginal()` 구현
- [ ] Phase 2 테스트 케이스 통과

### Phase 3 완료 조건

- [ ] 새 메시지 타입 추가
- [ ] Content Script 메시지 핸들러 수정
- [ ] Background 메시지 핸들러 수정
- [ ] 레거시 메시지 타입 제거
- [ ] 추가 인라인 요소 지원 (`<a>`, `<strong>`, `<em>`)
- [ ] 에러 처리 강화

### Phase 4 진입 조건

- [ ] 다른 추출 전략이 실제로 필요해짐
- [ ] 사이트별 전략 분기 요구사항 발생
- [ ] PLAN_EXTRACTION_STRATEGY.md 참조하여 구현

---

## 7. 참고 문서

- [PLAN_REFACTOR_DOM_EXTRACTOR.md](PLAN_REFACTOR_DOM_EXTRACTOR.md): 문제 진단 및 해결 방안 상세
- [PLAN_EXTRACTION_STRATEGY.md](PLAN_EXTRACTION_STRATEGY.md): Strategy Pattern 설계 (Phase 4 참조)
