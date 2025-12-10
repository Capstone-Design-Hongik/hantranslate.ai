# HanTranslate.ai MVP 구현 계획

## 목표

Chrome Built-in AI를 활용한 최소 동작 가능한 번역 익스텐션 구현

### MVP 범위

- Popup UI: 번역 버튼 + 상태 표시
- Background: Translator API + LanguageDetector API
- Content Script: 확장 가능한 DOM 텍스트 추출/교체
- 모델 다운로드 진행률 표시

### MVP 제외 항목

- 사용자 설정 (Options 페이지)
- shadcn/ui (기본 HTML 사용)
- 번역 캐싱
- 자동 번역
- 원문 복원 기능

---

## 1. 디렉토리 구조

```
src/
├── background/
│   ├── index.ts              # Service Worker 진입점
│   ├── translator.ts         # Translator API 래퍼
│   ├── languageDetector.ts   # LanguageDetector API 래퍼
│   └── messageHandler.ts     # 메시지 핸들러
├── content/
│   ├── index.ts              # Content Script 진입점
│   ├── domExtractor.ts       # DOM에서 텍스트 추출
│   └── domReplacer.ts        # 번역된 텍스트로 DOM 교체
├── popup/
│   ├── index.tsx             # Popup 진입점
│   └── App.tsx               # Popup 컴포넌트
└── shared/
    ├── types.ts              # 공유 타입 정의
    └── messages.ts           # 메시지 타입 정의
```

---

## 2. 타입 정의

### shared/types.ts

```typescript
// 번역 상태
export type TranslationStatus =
  | 'idle'
  | 'detecting'
  | 'downloading'
  | 'translating'
  | 'completed'
  | 'error';

// 다운로드 모델 종류
export type ModelType = 'detector' | 'translator';
```

### shared/messages.ts

```typescript
// Popup → Background
export type PopupMessage =
  | { type: 'START_TRANSLATION' }
  | { type: 'GET_STATUS' };

// Background → Popup (응답)
export type BackgroundResponse =
  | { type: 'STATUS'; status: TranslationStatus; error?: string }
  | { type: 'DOWNLOAD_PROGRESS'; model: ModelType; progress: number }
  | { type: 'LANGUAGE_DETECTED'; language: string };

// Background → Content
export type ContentMessage =
  | { type: 'GET_TEXT_NODES' }
  | { type: 'REPLACE_TEXT'; replacements: Array<{ index: number; text: string }> };

// Content → Background
export type ContentResponse =
  | { type: 'TEXT_NODES'; texts: string[] }
  | { type: 'REPLACE_DONE' };
```

---

## 3. Background Service Worker

### background/index.ts

```typescript
import { handleMessage } from './messageHandler';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // 비동기 응답
});
```

### background/languageDetector.ts

```typescript
let detector: LanguageDetector | null = null;

export async function detectLanguage(
  text: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!('LanguageDetector' in self)) {
    throw new Error('LanguageDetector API not supported');
  }

  if (!detector) {
    detector = await LanguageDetector.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          onProgress?.(e.loaded);
        });
      },
    });
  }

  const results = await detector.detect(text);
  return results[0]?.detectedLanguage ?? 'unknown';
}
```

### background/translator.ts

```typescript
let translator: Translator | null = null;
let currentSourceLang: string | null = null;

export async function translate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string = 'ko',
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!('Translator' in self)) {
    throw new Error('Translator API not supported');
  }

  // 언어가 바뀌면 인스턴스 재생성
  if (!translator || currentSourceLang !== sourceLanguage) {
    translator = await Translator.create({
      sourceLanguage,
      targetLanguage,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          onProgress?.(e.loaded);
        });
      },
    });
    currentSourceLang = sourceLanguage;
  }

  return await translator.translate(text);
}
```

### background/messageHandler.ts

```typescript
import { detectLanguage } from './languageDetector';
import { translate } from './translator';
import type { PopupMessage, BackgroundResponse, ContentResponse } from '../shared/messages';

export async function handleMessage(
  message: PopupMessage,
  sender: chrome.runtime.MessageSender
): Promise<BackgroundResponse> {
  if (message.type === 'GET_STATUS') {
    return { type: 'STATUS', status: 'idle' };
  }

  if (message.type === 'START_TRANSLATION') {
    return await handleTranslation();
  }

  return { type: 'STATUS', status: 'error', error: 'Unknown message' };
}

async function handleTranslation(): Promise<BackgroundResponse> {
  try {
    // 1. 현재 탭에서 텍스트 추출
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) throw new Error('No active tab');

    const textResponse = await chrome.tabs.sendMessage(tab.id, {
      type: 'GET_TEXT_NODES',
    }) as ContentResponse;

    if (textResponse.type !== 'TEXT_NODES' || textResponse.texts.length === 0) {
      return { type: 'STATUS', status: 'completed' };
    }

    // 2. 언어 감지 (첫 1000자 샘플)
    const sample = textResponse.texts.slice(0, 5).join(' ').slice(0, 1000);
    const detectedLang = await detectLanguage(sample);

    if (detectedLang === 'ko') {
      return { type: 'STATUS', status: 'completed' }; // 이미 한국어
    }

    // 3. 번역
    const translations = await Promise.all(
      textResponse.texts.map((text) => translate(text, detectedLang))
    );

    // 4. DOM 교체
    const replacements = translations.map((text, index) => ({ index, text }));
    await chrome.tabs.sendMessage(tab.id, {
      type: 'REPLACE_TEXT',
      replacements,
    });

    return { type: 'STATUS', status: 'completed' };
  } catch (error) {
    return {
      type: 'STATUS',
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

---

## 4. Content Script

### content/domExtractor.ts

```typescript
const EXCLUDED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE',
  'TEXTAREA', 'INPUT', 'SVG', 'MATH',
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
    }
  );

  let node: Text | null;
  while ((node = walker.nextNode() as Text)) {
    extractedNodes.push(node);
    texts.push(node.textContent || '');
  }

  return texts;
}

export function getExtractedNodes(): Text[] {
  return extractedNodes;
}
```

### content/domReplacer.ts

```typescript
import { getExtractedNodes } from './domExtractor';

export function replaceTextNodes(
  replacements: Array<{ index: number; text: string }>
): void {
  const nodes = getExtractedNodes();

  for (const { index, text } of replacements) {
    const node = nodes[index];
    if (node) {
      node.textContent = text;
    }
  }
}
```

### content/index.ts

```typescript
import { extractTextNodes } from './domExtractor';
import { replaceTextNodes } from './domReplacer';
import type { ContentMessage, ContentResponse } from '../shared/messages';

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse) => {
    if (message.type === 'GET_TEXT_NODES') {
      const texts = extractTextNodes();
      sendResponse({ type: 'TEXT_NODES', texts } as ContentResponse);
    }

    if (message.type === 'REPLACE_TEXT') {
      replaceTextNodes(message.replacements);
      sendResponse({ type: 'REPLACE_DONE' } as ContentResponse);
    }

    return true;
  }
);
```

---

## 5. Popup UI (기본 HTML)

### popup/App.tsx

```tsx
import { useState } from 'react';
import type { TranslationStatus, ModelType } from '../shared/types';
import type { BackgroundResponse } from '../shared/messages';

export function App() {
  const [status, setStatus] = useState<TranslationStatus>('idle');
  const [downloadProgress, setDownloadProgress] = useState<{
    model: ModelType;
    progress: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTranslate = async () => {
    setStatus('detecting');
    setError(null);

    const response: BackgroundResponse = await chrome.runtime.sendMessage({
      type: 'START_TRANSLATION',
    });

    if (response.type === 'STATUS') {
      setStatus(response.status);
      if (response.error) setError(response.error);
    }
  };

  const isLoading = status === 'detecting' || status === 'downloading' || status === 'translating';

  return (
    <div style={{ width: 280, padding: 16, fontFamily: 'system-ui' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>HanTranslate.ai</h2>

      {/* 다운로드 진행률 */}
      {downloadProgress && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
            {downloadProgress.model === 'detector' ? '언어 감지' : '번역'} 모델 다운로드 중...
          </div>
          <div style={{ background: '#eee', borderRadius: 4, height: 8 }}>
            <div
              style={{
                background: '#4285f4',
                borderRadius: 4,
                height: '100%',
                width: `${downloadProgress.progress * 100}%`,
                transition: 'width 0.2s',
              }}
            />
          </div>
        </div>
      )}

      {/* 상태 메시지 */}
      {status === 'completed' && (
        <div style={{ padding: 8, background: '#e8f5e9', borderRadius: 4, marginBottom: 12, fontSize: 14 }}>
          번역 완료
        </div>
      )}
      {error && (
        <div style={{ padding: 8, background: '#ffebee', borderRadius: 4, marginBottom: 12, fontSize: 14, color: '#c62828' }}>
          {error}
        </div>
      )}

      {/* 번역 버튼 */}
      <button
        onClick={handleTranslate}
        disabled={isLoading}
        style={{
          width: '100%',
          padding: '10px 16px',
          fontSize: 14,
          fontWeight: 500,
          border: 'none',
          borderRadius: 6,
          background: isLoading ? '#ccc' : '#4285f4',
          color: 'white',
          cursor: isLoading ? 'not-allowed' : 'pointer',
        }}
      >
        {isLoading ? '번역 중...' : '이 페이지 번역하기'}
      </button>
    </div>
  );
}
```

---

## 6. manifest.json

```json
{
  "manifest_version": 3,
  "name": "HanTranslate.ai",
  "description": "Chrome Built-in AI를 활용한 한국어 번역",
  "version": "0.1.0",

  "action": {
    "default_popup": "popup.html",
    "default_icon": "icon.png"
  },

  "background": {
    "service_worker": "js/background.js",
    "type": "module"
  },

  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["js/content.js"]
  }],

  "permissions": ["activeTab"]
}
```

---

## 7. 구현 순서

### Phase 1: 기반 설정
- [ ] `@types/dom-chromium-ai` 설치
- [ ] 디렉토리 구조 생성
- [ ] 타입 정의 (`shared/types.ts`, `shared/messages.ts`)

### Phase 2: Background 구현
- [ ] `languageDetector.ts` - 언어 감지 API 래퍼
- [ ] `translator.ts` - 번역 API 래퍼
- [ ] `messageHandler.ts` - 메시지 처리 로직
- [ ] `index.ts` - Service Worker 진입점

### Phase 3: Content Script 구현
- [ ] `domExtractor.ts` - 텍스트 노드 추출
- [ ] `domReplacer.ts` - 텍스트 교체
- [ ] `index.ts` - 메시지 리스너

### Phase 4: Popup UI 구현
- [ ] `App.tsx` - 기본 UI
- [ ] `index.tsx` - 진입점

### Phase 5: 빌드 및 테스트
- [ ] Webpack entry 설정 확인
- [ ] 빌드 테스트
- [ ] Chrome에서 동작 확인

---

## 8. 핵심 API 요약

### LanguageDetector

```typescript
// Feature detection
if (!('LanguageDetector' in self)) { /* 미지원 */ }

// 생성 (다운로드 포함)
const detector = await LanguageDetector.create({
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => console.log(e.loaded));
  },
});

// 감지
const results = await detector.detect(text);
// [{ detectedLanguage: 'en', confidence: 0.99 }, ...]
```

### Translator

```typescript
// Feature detection
if (!('Translator' in self)) { /* 미지원 */ }

// 생성 (다운로드 포함)
const translator = await Translator.create({
  sourceLanguage: 'en',
  targetLanguage: 'ko',
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => console.log(e.loaded));
  },
});

// 번역
const result = await translator.translate(text);
```

---

## 9. 확장 포인트

MVP 이후 확장할 수 있는 지점들:

1. **DOM 처리 확장**
   - `domExtractor.ts`에 MutationObserver 추가 (SPA 지원)
   - IntersectionObserver로 뷰포트 우선 번역

2. **상태 관리 확장**
   - `chrome.storage`로 번역 상태 저장
   - 원문 복원 기능

3. **UI 확장**
   - Options 페이지
   - 진행률 상세 표시

4. **성능 최적화**
   - 청크 분할 번역
   - 번역 캐싱
