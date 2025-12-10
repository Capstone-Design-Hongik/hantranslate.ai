# Chrome Built-in AI 번역 익스텐션 구현 계획

## 1. 디렉토리 구조 재설계

```
src/
├── background/
│   ├── index.ts                    # Service Worker 진입점
│   ├── languageDetector.ts         # LanguageDetector API 래퍼
│   ├── translator.ts               # Translator API 래퍼
│   ├── errors.ts                   # 커스텀 에러 타입 정의
│   └── state.ts                    # 번역 상태 관리 (storage 연동)
├── content/
│   ├── index.tsx                   # Content Script 진입점
│   ├── domExtractor.ts             # DOM에서 텍스트 추출
│   ├── domReplacer.ts              # 번역된 텍스트로 DOM 교체
│   └── mutationObserver.ts         # SPA 동적 콘텐츠 감지
├── popup/
│   ├── index.tsx                   # Popup 진입점
│   ├── App.tsx                     # 메인 Popup 컴포넌트
│   └── components/
│       ├── TranslateButton.tsx     # 번역 시작 버튼
│       ├── DownloadProgress.tsx    # 모델 다운로드 진행률
│       ├── LanguageBadge.tsx       # 언어 표시 배지
│       └── StatusAlert.tsx         # 상태 메시지 표시
├── options/
│   ├── index.tsx                   # Options 페이지 진입점
│   ├── App.tsx                     # Options 메인 컴포넌트
│   └── components/                 # Options 전용 컴포넌트
│       └── SettingsForm.tsx        # 설정 폼 컴포넌트
├── shared/
│   ├── types.ts                    # 공유 타입 정의
│   ├── messages.ts                 # 타입 안전한 메시지 정의
│   ├── settings.ts                 # 사용자 설정 타입 및 기본값
│   └── constants.ts                # 상수 정의
├── components/
│   └── ui/                         # shadcn/ui 컴포넌트
│       ├── button.tsx
│       ├── progress.tsx
│       ├── card.tsx
│       ├── badge.tsx
│       ├── alert.tsx
│       └── spinner.tsx
├── lib/
│   └── utils.ts                    # cn() 유틸리티
└── __tests__/
    ├── unit/
    │   ├── domExtractor.test.ts
    │   ├── domReplacer.test.ts
    │   └── messages.test.ts
    ├── integration/
    │   ├── background.test.ts
    │   └── messaging.test.ts
    └── e2e/
        └── translation.test.ts
```

## 2. 타입 정의

### `@types/chrome` vs `@types/dom-chromium-ai`

| 패키지 | 범위 | 예시 |
|--------|------|------|
| `@types/chrome` | Chrome Extension API | `chrome.runtime`, `chrome.storage`, `chrome.tabs` |
| `@types/dom-chromium-ai` | Chrome Built-in AI API (Web Platform) | `LanguageDetector`, `Translator`, `Summarizer` |

Built-in AI API는 `chrome.*` 네임스페이스가 아닌 **전역 객체**(`window`/`self`)에 존재하므로 별도 타입 패키지가 필요합니다.

### 설치

```bash
pnpm add -D @types/dom-chromium-ai
```

### 사용

TypeScript 파일에서 reference 추가:

```typescript
/// <reference types="dom-chromium-ai" />
```

또는 `tsconfig.json`의 `types`에 추가:

```json
{
  "compilerOptions": {
    "types": ["dom-chromium-ai"]
  }
}
```

## 3. 에러 처리 및 Fallback 전략

### 커스텀 에러 타입 (background/errors.ts)

```typescript
export class UnsupportedBrowserError extends Error {
  constructor(feature: 'Translator' | 'LanguageDetector') {
    super(`${feature} API is not supported in this browser`);
    this.name = 'UnsupportedBrowserError';
  }
}

export class ModelUnavailableError extends Error {
  constructor(sourceLanguage: string, targetLanguage: string) {
    super(`Translation model for ${sourceLanguage} → ${targetLanguage} is not available`);
    this.name = 'ModelUnavailableError';
  }
}

// 에러 핸들링 헬퍼 - Popup/Content에서 오는 에러를 일괄 처리
export function handleError(error: unknown): {
  type: 'unsupported' | 'unavailable' | 'unknown';
  message: string;
} {
  if (error instanceof UnsupportedBrowserError) {
    return { type: 'unsupported', message: error.message };
  }
  if (error instanceof ModelUnavailableError) {
    return { type: 'unavailable', message: error.message };
  }
  return {
    type: 'unknown',
    message: error instanceof Error ? error.message : 'Unknown error',
  };
}
```

### Feature Detection 및 Fallback

```typescript
// background/translator.ts
if (!('Translator' in self)) {
  // Fallback 전략:
  // 1. 사용자에게 Chrome Canary/Dev 채널 안내
  // 2. 기능 비활성화 및 UI 피드백
  throw new UnsupportedBrowserError('Translator');
}
```

## 4. API 가용성 사전 확인

```typescript
// background/translator.ts
type AvailabilityStatus = 'unavailable' | 'downloadable' | 'downloading' | 'available';

async function checkModelAvailability(
  sourceLanguage: string,
  targetLanguage: string
): Promise<AvailabilityStatus> {
  const availability = await Translator.availability({
    sourceLanguage,
    targetLanguage,
  });
  return availability;
}

// 사용 예시
const status = await checkModelAvailability('en', 'ko');
switch (status) {
  case 'unavailable':
    // 해당 언어 쌍 지원 안 됨 - 사용자에게 알림
    break;
  case 'downloadable':
    // 다운로드 필요 - 사용자에게 알림 후 진행
    break;
  case 'downloading':
    // 이미 다운로드 중 - 진행률 표시
    break;
  case 'available':
    // 즉시 사용 가능
    break;
}
```

## 5. 메시지 통신 구조 (타입 안전)

### 메시지 타입 정의 (src/shared/messages.ts)

```typescript
// Discriminated Union 패턴으로 타입 안전한 메시지 정의

// === Popup → Background ===
export type PopupToBackgroundMessage =
  | { type: 'START_TRANSLATION' }
  | { type: 'STOP_TRANSLATION' }
  | { type: 'GET_STATUS' };

// === Background → Popup ===
export type BackgroundToPopupMessage =
  | { type: 'MODEL_DOWNLOAD_PROGRESS'; progress: number; model: 'detector' | 'translator' }
  | { type: 'LANGUAGE_DETECTED'; language: string; confidence: number }
  | { type: 'TRANSLATION_STATUS'; status: TranslationStatus; error?: string };

// === Background → Content ===
export type BackgroundToContentMessage =
  | { type: 'GET_PAGE_CONTENT' }
  | { type: 'REPLACE_CONTENT'; translations: TranslationResult[] };

// === Content → Background ===
export type ContentToBackgroundMessage =
  | { type: 'PAGE_CONTENT'; content: PageContent }
  | { type: 'TRANSLATION_APPLIED'; success: boolean };

// 상태 타입
export type TranslationStatus =
  | 'idle'
  | 'detecting'
  | 'downloading'
  | 'translating'
  | 'completed'
  | 'error';

// 타입 가드 헬퍼
export function isBackgroundToPopupMessage(
  msg: unknown
): msg is BackgroundToPopupMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    ['MODEL_DOWNLOAD_PROGRESS', 'LANGUAGE_DETECTED', 'TRANSLATION_STATUS'].includes(
      (msg as { type: string }).type
    )
  );
}
```

### 메시지 흐름

| 방향 | 메시지 타입 | 용도 |
|------|------------|------|
| Popup → Background | `START_TRANSLATION` | 번역 시작 요청 |
| Background → Popup | `MODEL_DOWNLOAD_PROGRESS` | 모델 다운로드 진행률 |
| Background → Popup | `TRANSLATION_STATUS` | 번역 상태 업데이트 |
| Background → Content | `GET_PAGE_CONTENT` | 페이지 텍스트 요청 |
| Content → Background | `PAGE_CONTENT` | 페이지 텍스트 응답 |
| Background → Content | `REPLACE_CONTENT` | 번역된 텍스트로 DOM 교체 |

## 6. 구현 단계

### Step 1: 기반 설정
- [ ] `@types/dom-chromium-ai` 패키지 설치
- [ ] `manifest.json` 권한 업데이트 (필요시)
- [ ] 디렉토리 구조 생성
- [ ] 커스텀 에러 타입 정의 (`background/errors.ts`)
- [ ] 공유 타입 및 메시지 상수 정의 (Discriminated Union 패턴)
- [ ] 사용자 설정 타입 및 기본값 정의 (`shared/settings.ts`)

### Step 2: Background Service Worker
- [ ] LanguageDetector 인스턴스 생성 및 관리
- [ ] Translator 인스턴스 생성 및 관리
- [ ] `availability()` API 활용한 모델 상태 사전 체크
- [ ] Service Worker 인스턴스 재생성 패턴 구현 (생명주기 대응)
- [ ] 번역 상태 관리 모듈 구현 (`state.ts` - storage 연동)
- [ ] 탭 ID 기반 번역 작업 관리 (탭 종료 시 상태 정리)
- [ ] 모델 다운로드 진행률 이벤트 처리
- [ ] `translateStreaming()` 을 통한 청크 단위 번역
- [ ] Popup/Content Script와 메시지 통신
- [ ] 번역 캐싱 로직 구현

### Step 3: Content Script
- [ ] 페이지 DOM에서 텍스트 노드 추출
- [ ] DOM 필터링 상수 및 함수 구현 (EXCLUDED_TAGS, shouldSkipElement)
- [ ] 번역 대상 요소 식별 (body 내 텍스트)
- [ ] 번역된 텍스트로 DOM 교체 (XSS 방지: textContent 사용)
- [ ] 원문 저장/복원 로직 (WeakMap 활용)
- [ ] MutationObserver 설정 (SPA 지원, 중복 등록 방지)
- [ ] Background와 메시지 통신

### Step 4: Popup UI (shadcn/ui 활용)
- [ ] 번역 시작 버튼 (`Button`, `Spinner`)
- [ ] 모델 다운로드 진행률 표시 (`Progress`, `Card`)
- [ ] 언어 감지 결과 표시 (`Badge`)
- [ ] 번역 진행률 및 완료 상태 표시 (`Alert`)
- [ ] 접근성 속성 추가 (`role`, `aria-live`)

### Step 5: Options 페이지 (`src/options/`)
- [ ] Options 페이지 진입점 및 App 컴포넌트 구현
- [ ] SettingsForm 컴포넌트 구현
- [ ] chrome.storage.sync와 연동
- [ ] 설정 마이그레이션 로직 적용

### Step 6: Webpack 설정 업데이트
- [ ] 새 디렉토리 구조에 맞게 entry point 수정

### Step 7: 테스트 작성
- [ ] Unit 테스트 (Jest)
- [ ] Integration 테스트 (Jest + chrome-mock)
- [ ] E2E 테스트 (Puppeteer / Playwright)

## 7. 핵심 API 사용 패턴

### LanguageDetector (background)

```typescript
// Feature detection
if (!('LanguageDetector' in self)) {
  throw new UnsupportedBrowserError('LanguageDetector');
}

// 인스턴스 생성 및 모델 다운로드
const detector = await LanguageDetector.create({
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Downloaded ${e.loaded * 100}%`);
      // Popup으로 진행률 전송
    });
  },
});

// 언어 감지
const results = await detector.detect(text);
const topResult = results[0]; // { detectedLanguage: 'en', confidence: 0.99 }
```

### Translator (background)

```typescript
// Feature detection
if (!('Translator' in self)) {
  throw new UnsupportedBrowserError('Translator');
}

// 인스턴스 생성 및 모델 다운로드
const translator = await Translator.create({
  sourceLanguage: detectedLang, // 감지된 언어
  targetLanguage: 'ko',         // 고정: 한국어
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Downloaded ${e.loaded * 100}%`);
      // Popup으로 진행률 전송
    });
  },
});

// 스트리밍 번역
const stream = translator.translateStreaming(text);
for await (const chunk of stream) {
  console.log(chunk);
  // Content Script로 청크 전송
}
```

## 8. Service Worker 생명주기 관리

Service Worker는 약 30초 후 idle 상태로 종료됩니다. 이때 생성된 Translator/LanguageDetector 인스턴스가 손실됩니다.

### 번역 상태 타입 및 저장 (background/state.ts)

SW가 종료/재시작되어도 상태를 복원할 수 있도록 `chrome.storage.session`(또는 `storage.local`)에 저장합니다.

```typescript
// background/state.ts
export interface TranslationState {
  status: TranslationStatus;
  currentTabId?: number;      // 현재 번역 중인 탭 ID
  progress?: number;          // 번역 진행률 (0-100)
  detectedLanguage?: string;  // 감지된 언어
  error?: string;             // 에러 메시지
}

const STORAGE_KEY = 'translationState';

export async function saveState(state: TranslationState): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: state });
}

export async function loadState(): Promise<TranslationState> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return result[STORAGE_KEY] ?? { status: 'idle' };
}

export async function clearState(): Promise<void> {
  await chrome.storage.session.remove(STORAGE_KEY);
}

// 탭이 닫혔을 때 해당 탭의 번역 상태 정리
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await loadState();
  if (state.currentTabId === tabId) {
    await clearState();
  }
});
```

### 인스턴스 재생성 패턴

```typescript
// background/index.ts

// 인스턴스 재생성 패턴 (권장)
let translatorInstance: Translator | null = null;
let currentSourceLang: string | null = null;

async function getTranslator(
  sourceLanguage: string,
  targetLanguage: string
): Promise<Translator> {
  // 인스턴스가 없거나 언어 쌍이 다르면 재생성
  if (!translatorInstance || currentSourceLang !== sourceLanguage) {
    translatorInstance = await Translator.create({
      sourceLanguage,
      targetLanguage,
      monitor: createDownloadMonitor(),
    });
    currentSourceLang = sourceLanguage;
  }
  return translatorInstance;
}
```

## 9. DOM 처리 (Content Script)

### 필터링 기준 (content/domExtractor.ts)

```typescript
// 번역 제외 대상 요소
const EXCLUDED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
  'VAR',
  'TEXTAREA',
  'INPUT',
  'SVG',
  'MATH',
]);

// 번역 제외 조건
function shouldSkipElement(element: Element): boolean {
  // 1. 제외 태그
  if (EXCLUDED_TAGS.has(element.tagName)) return true;

  // 2. contenteditable 요소
  if (element.getAttribute('contenteditable') === 'true') return true;

  // 3. data-no-translate 속성
  if (element.hasAttribute('data-no-translate')) return true;

  // 4. 이미 번역된 요소
  if (element.hasAttribute('data-translated')) return true;

  // 5. hidden 요소
  if (element.getAttribute('aria-hidden') === 'true') return true;

  return false;
}
```

### 원문 저장/복원

```typescript
// 번역 전 원문 저장
const originalTextMap = new WeakMap<Text, string>();

function saveOriginalText(textNode: Text): void {
  originalTextMap.set(textNode, textNode.textContent || '');
}

function restoreOriginalText(textNode: Text): void {
  const original = originalTextMap.get(textNode);
  if (original) {
    textNode.textContent = original;
  }
}
```

### SPA 지원 (MutationObserver)

```typescript
// content/mutationObserver.ts
let isTranslationEnabled = false;

// 중복 등록 방지를 위한 observer 참조 유지
let observer: MutationObserver | null = null;

function setupMutationObserver(): void {
  // 이미 등록된 경우 재등록하지 않음
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    if (!isTranslationEnabled) return;

    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          // 새로 추가된 요소 내 텍스트 번역
          translateElement(element);
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function stopMutationObserver(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

function startTranslation(): void {
  isTranslationEnabled = true;
  setupMutationObserver();
}

function stopTranslation(): void {
  isTranslationEnabled = false;
  stopMutationObserver();
}
```

## 10. 성능 최적화

### 청크 분할

```typescript
const CHUNK_SIZE = 5000; // 5000자 단위

function splitTextIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}
```

### 배치 처리

```typescript
const BATCH_SIZE = 10;

async function translateBatch(nodes: TextNode[]): Promise<void> {
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(node => translateNode(node)));
  }
}
```

### 번역 캐싱

```typescript
const translationCache = new Map<string, string>();

async function translateWithCache(text: string): Promise<string> {
  const cached = translationCache.get(text);
  if (cached) return cached;

  const translated = await translator.translate(text);
  translationCache.set(text, translated);
  return translated;
}
```

### Intersection Observer (뷰포트 우선 번역)

```typescript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      translateElement(entry.target);
      observer.unobserve(entry.target);
    }
  });
});

translatableElements.forEach(el => observer.observe(el));
```

## 11. 보안 고려사항

### XSS 방지

```typescript
// ❌ 위험
element.innerHTML = translatedText;

// ✅ 안전
textNode.textContent = translatedText;
```

### CSP 정책

```typescript
// manifest.json에 web_accessible_resources 추가 고려
{
  "web_accessible_resources": [{
    "resources": ["styles/*.css"],
    "matches": ["<all_urls>"]
  }]
}
```

### 입력 검증

```typescript
function validateTextForTranslation(text: string): boolean {
  // 빈 텍스트 제외
  if (!text.trim()) return false;

  // 너무 긴 텍스트 제한
  if (text.length > 50000) return false;

  // 숫자/특수문자만 있는 텍스트 제외
  if (!/[a-zA-Z\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text)) return false;

  return true;
}
```

## 12. 사용자 설정 (shared/settings.ts)

```typescript
export interface UserSettings {
  // 스키마 버전 (설정 마이그레이션용)
  schemaVersion: number;

  // 번역 설정
  autoTranslate: boolean;           // 페이지 로드 시 자동 번역
  targetLanguage: string;           // 번역 대상 언어 (기본: 'ko')
  showOriginalOnHover: boolean;     // 호버 시 원문 표시

  // 제외 설정
  excludedDomains: string[];        // 번역 제외 도메인 목록
  excludedSelectors: string[];      // 번역 제외 CSS 선택자

  // UI 설정
  showProgressNotification: boolean; // 진행률 알림 표시
  theme: 'light' | 'dark' | 'system'; // 테마

  // 고급 설정
  chunkSize: number;                // 청크 크기 (기본: 5000)
  enableCache: boolean;             // 번역 캐싱 활성화
}

// 현재 스키마 버전
export const CURRENT_SCHEMA_VERSION = 1;

export const defaultSettings: UserSettings = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  autoTranslate: false,
  targetLanguage: 'ko',
  showOriginalOnHover: true,
  excludedDomains: [],
  excludedSelectors: [],
  showProgressNotification: true,
  theme: 'system',
  chunkSize: 5000,
  enableCache: true,
};

// 설정 마이그레이션 함수 (버전 업그레이드 시 사용)
export function migrateSettings(settings: Partial<UserSettings>): UserSettings {
  const version = settings.schemaVersion ?? 0;

  // 버전별 마이그레이션 로직
  if (version < 1) {
    // v0 → v1 마이그레이션: 기본값으로 초기화
    return { ...defaultSettings };
  }

  return { ...defaultSettings, ...settings };
}
```

## 13. 테스트 전략

### 테스트 레벨별 계획

| 레벨 | 대상 | 도구 |
|------|------|------|
| Unit | DOM extractor/replacer 함수, 메시지 타입 가드 | Jest |
| Integration | 메시지 통신 흐름, 상태 관리 | Jest + chrome-mock |
| E2E | 실제 페이지 번역 | Puppeteer / Playwright |

### Mock 전략

```typescript
// __mocks__/chrome.ts
export const chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
    },
  },
};

// Built-in AI Mock
export const mockTranslator = {
  create: jest.fn().mockResolvedValue({
    translate: jest.fn().mockResolvedValue('번역된 텍스트'),
    translateStreaming: jest.fn(),
  }),
  availability: jest.fn().mockResolvedValue('available'),
};
```

## 14. manifest.json 업데이트 사항

```json
{
  "manifest_version": 3,
  "name": "HanTranslate.ai",
  "description": "Chrome Built-in AI를 활용한 한국어 번역 익스텐션",
  "version": "1.0",

  "action": {
    "default_icon": "icon.png",
    "default_popup": "popup.html"
  },

  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["js/vendor.js", "js/content.js"]
    }
  ],

  "background": {
    "service_worker": "js/background.js",
    "type": "module"
  },

  "permissions": ["storage", "activeTab"],
  "host_permissions": ["<all_urls>"],

  "options_page": "options.html",

  "web_accessible_resources": [{
    "resources": ["styles/*.css"],
    "matches": ["<all_urls>"]
  }]
}
```

## 15. 예상 작업 순서

1. [ ] 타입 패키지 설치 (`@types/dom-chromium-ai`)
2. [ ] 커스텀 에러 타입 및 handleError 헬퍼 정의 (`background/errors.ts`)
3. [ ] 공유 타입/메시지 정의 (`src/shared/`) - Discriminated Union 패턴
4. [ ] 사용자 설정 타입, 기본값, 마이그레이션 함수 정의 (`src/shared/settings.ts`)
5. [ ] Background 모듈 구현 (`src/background/`)
    - API 가용성 체크 로직
    - Service Worker 인스턴스 관리
    - 번역 상태 관리 (`state.ts` - storage 연동)
    - 탭 ID 기반 작업 관리
    - 번역 캐싱
6. [ ] Content Script 모듈 구현 (`src/content/`)
    - DOM 필터링 상수 및 함수
    - MutationObserver 설정 (중복 등록 방지)
    - 원문 저장/복원 로직
7. [ ] shadcn/ui 컴포넌트 설치 (`button`, `progress`, `card`, `badge`, `alert`, `spinner`)
8. [ ] Popup UI 컴포넌트 구현 (`src/popup/components/`)
    - 접근성 속성 추가
9. [ ] Popup 메인 레이아웃 구현 (`src/popup/App.tsx`)
10. [ ] Options 페이지 구현 (`src/options/`)
    - 진입점 및 App 컴포넌트
    - SettingsForm 컴포넌트
    - 설정 마이그레이션 적용
11. [ ] Webpack 설정 업데이트 (options entry 추가)
12. [ ] 테스트 작성 (Unit → Integration → E2E)
13. [ ] 통합 테스트

## 16. 주요 고려사항

### 모델 다운로드
- Language Detector와 Translator 모델은 최초 사용 시 다운로드됨
- 다운로드 진행률을 사용자에게 표시하여 UX 개선
- `availability()` API로 모델 상태 사전 확인 가능

### 스트리밍 번역
- `translateStreaming()`을 사용하여 긴 텍스트도 청크 단위로 번역
- 사용자에게 점진적인 번역 결과 표시 가능
- 번역이 순차적으로 처리되므로 적절한 로딩 UI 필요

### DOM 처리
- 텍스트 노드만 추출하여 번역 (HTML 구조 유지)
- 스크립트, 스타일 등 번역 불필요 요소 제외 (EXCLUDED_TAGS 활용)
- 번역 후 원본 DOM 구조 보존하며 텍스트만 교체
- XSS 방지를 위해 textContent 사용

### 브라우저 호환성
- Chrome Canary/Dev 채널에서만 Built-in AI API 지원
- Feature detection으로 미지원 브라우저 대응
- 사용자에게 적절한 안내 메시지 제공

### 확장성
- 모듈화된 구조로 향후 기능 추가 용이
- shadcn/ui 기반 컴포넌트 구조
- 메시지 타입 중앙 관리로 유지보수성 향상
- Discriminated Union 패턴으로 타입 안전성 확보

## 17. 기타 개선사항 (추후 구현)

### 접근성 (a11y)

```typescript
// Popup UI에 접근성 속성 추가
<div role="status" aria-live="polite">
  {status === 'translating' && '번역 중...'}
</div>
```

### 부분 선택 번역

```typescript
// 사용자가 선택한 텍스트만 번역
document.addEventListener('mouseup', () => {
  const selection = window.getSelection();
  if (selection && selection.toString().trim()) {
    showTranslateOption(selection);
  }
});
```

## 18. shadcn/ui 컴포넌트 활용 계획

### 설치

```bash
pnpm dlx shadcn@latest add button progress card badge alert spinner
```

### 컴포넌트 매핑

| UI 요소 | shadcn 컴포넌트 | 용도 |
|---------|----------------|------|
| 번역 시작 버튼 | `Button` + `Spinner` | 번역 시작/로딩 상태 표시 |
| 진행률 표시 | `Progress` | 모델 다운로드 진행률 (0-100%) |
| UI 컨테이너 | `Card` | Popup 레이아웃 래핑 |
| 언어 표시 | `Badge` | 감지된 언어 및 대상 언어 표시 |
| 상태 메시지 | `Alert` | 완료/에러 메시지 표시 |

### 컴포넌트 구현 예시

#### TranslateButton.tsx

```tsx
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

interface TranslateButtonProps {
  isLoading: boolean
  onClick: () => void
  disabled?: boolean
}

export function TranslateButton({ isLoading, onClick, disabled }: TranslateButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="w-full"
    >
      {isLoading ? (
        <>
          <Spinner className="mr-2" />
          번역 중...
        </>
      ) : (
        "번역 시작"
      )}
    </Button>
  )
}
```

#### DownloadProgress.tsx

```tsx
import { Progress } from "@/components/ui/progress"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface DownloadProgressProps {
  title: string
  progress: number
}

export function DownloadProgress({ title, progress }: DownloadProgressProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Progress value={progress} />
        <p className="text-xs text-muted-foreground mt-1">
          {Math.round(progress)}% 완료
        </p>
      </CardContent>
    </Card>
  )
}
```

#### LanguageBadge.tsx

```tsx
import { Badge } from "@/components/ui/badge"

interface LanguageBadgeProps {
  language: string
  type: "source" | "target"
}

const languageNames: Record<string, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  zh: "中文",
}

export function LanguageBadge({ language, type }: LanguageBadgeProps) {
  return (
    <Badge variant={type === "source" ? "outline" : "default"}>
      {languageNames[language] || language}
    </Badge>
  )
}
```

#### StatusAlert.tsx

```tsx
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { CheckCircle, AlertCircle, Info } from "lucide-react"

interface StatusAlertProps {
  status: "success" | "error" | "info"
  title: string
  description?: string
}

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
}

export function StatusAlert({ status, title, description }: StatusAlertProps) {
  const Icon = icons[status]

  return (
    <Alert variant={status === "error" ? "destructive" : "default"}>
      <Icon className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      {description && <AlertDescription>{description}</AlertDescription>}
    </Alert>
  )
}
```

### Popup 메인 레이아웃 (App.tsx)

```tsx
import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TranslateButton } from "./components/TranslateButton"
import { DownloadProgress } from "./components/DownloadProgress"
import { LanguageBadge } from "./components/LanguageBadge"
import { StatusAlert } from "./components/StatusAlert"

type TranslationStatus = "idle" | "detecting" | "downloading" | "translating" | "completed" | "error"

export function App() {
  const [status, setStatus] = useState<TranslationStatus>("idle")
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleTranslate = () => {
    chrome.runtime.sendMessage({ type: "START_TRANSLATION" })
  }

  useEffect(() => {
    const listener = (message: BackgroundToPopupMessage) => {
      switch (message.type) {
        case "MODEL_DOWNLOAD_PROGRESS":
          setStatus("downloading")
          setDownloadProgress(message.progress * 100)
          break
        case "LANGUAGE_DETECTED":
          setDetectedLanguage(message.language)
          break
        case "TRANSLATION_STATUS":
          setStatus(message.status)
          if (message.error) setErrorMessage(message.error)
          break
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  return (
    <div className="w-[320px] p-4">
      <Card>
        <CardHeader>
          <CardTitle>HanTranslate.ai</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 언어 표시 */}
          {detectedLanguage && (
            <div className="flex items-center gap-2">
              <LanguageBadge language={detectedLanguage} type="source" />
              <span className="text-muted-foreground">→</span>
              <LanguageBadge language="ko" type="target" />
            </div>
          )}

          {/* 다운로드 진행률 */}
          {status === "downloading" && (
            <DownloadProgress
              title="모델 다운로드 중..."
              progress={downloadProgress}
            />
          )}

          {/* 상태 메시지 */}
          {status === "completed" && (
            <StatusAlert
              status="success"
              title="번역 완료"
              description="페이지가 한국어로 번역되었습니다."
            />
          )}
          {status === "error" && errorMessage && (
            <StatusAlert
              status="error"
              title="오류 발생"
              description={errorMessage}
            />
          )}

          {/* 번역 버튼 */}
          <TranslateButton
            isLoading={status === "detecting" || status === "translating"}
            onClick={handleTranslate}
            disabled={status === "downloading"}
          />
        </CardContent>
      </Card>
    </div>
  )
}
```

### 주의사항

1. **번들 크기**: shadcn/ui는 필요한 컴포넌트만 설치하므로 번들 크기 최적화에 유리
2. **CSS 격리**: Content Script에서 사용 시 Shadow DOM을 고려해야 함 (현재는 Popup에서만 사용)

---

## 요약 테이블 (개선점 반영)

| # | 항목 | 중요도 | 난이도 | 상태 |
|---|------|--------|--------|------|
| 1 | 에러 처리 및 Fallback | 높음 | 중간 | 추가됨 |
| 2 | API 가용성 사전 확인 | 높음 | 낮음 | 추가됨 |
| 3 | DOM 필터링 기준 | 중간 | 낮음 | 추가됨 |
| 4 | 성능 최적화 | 중간 | 높음 | 추가됨 |
| 5 | Service Worker 생명주기 | 높음 | 중간 | 추가됨 |
| 6 | SPA 지원 | 중간 | 중간 | 추가됨 |
| 7 | 타입 안전성 | 중간 | 낮음 | 추가됨 |
| 8 | 테스트 전략 | 중간 | 높음 | 추가됨 |
| 9 | 보안 고려 | 높음 | 낮음 | 추가됨 |
| 10 | 사용자 설정 | 낮음 | 중간 | 추가됨 |

## 19. 추후 고려사항

MVP 이후 또는 확장 시점에 검토할 개선 사항들입니다.

### 메시지 통신 확장

```typescript
// 채널/출처 구분 필드 추가 (메시지가 많아지면 디버깅에 유용)
type MessageChannel = 'POPUP' | 'CONTENT' | 'BACKGROUND';

type BaseMessage = {
  channel: MessageChannel;
  timestamp?: number;
};

// requestId 기반 요청/응답 패턴 (복잡한 비동기 통신 시)
type RequestMessage = BaseMessage & {
  requestId: string;
};
```

### 테스트 Mock 분리

```typescript
// __mocks__/dom-chromium-ai.ts - 모듈 단위 mock으로 테스트 코드 단순화
export const Translator = {
  create: jest.fn().mockResolvedValue({
    translate: jest.fn().mockResolvedValue('번역된 텍스트'),
    translateStreaming: jest.fn(),
  }),
  availability: jest.fn().mockResolvedValue('available'),
};

export const LanguageDetector = {
  create: jest.fn().mockResolvedValue({
    detect: jest.fn().mockResolvedValue([
      { detectedLanguage: 'en', confidence: 0.99 },
    ]),
  }),
};
```

### Shadow DOM 지원

```typescript
// content/domExtractor.ts - Shadow DOM 내 텍스트 추출
function extractTextFromShadowDOM(root: ShadowRoot | Document): Text[] {
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    null
  );

  let node: Text | null;
  while ((node = walker.nextNode() as Text)) {
    textNodes.push(node);
  }

  // Shadow DOM 재귀 탐색
  const shadowHosts = root.querySelectorAll('*');
  shadowHosts.forEach((host) => {
    if (host.shadowRoot) {
      textNodes.push(...extractTextFromShadowDOM(host.shadowRoot));
    }
  });

  return textNodes;
}
```

### storage.onChanged 기반 상태 브로드캐스트

```typescript
// background/state.ts - Popup 상태 동기화 대안
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'session' && changes.translationState) {
    // 모든 Popup에 상태 변경 자동 전파
    chrome.runtime.sendMessage({
      type: 'STATE_CHANGED',
      state: changes.translationState.newValue,
    });
  }
});
```

### 배포 시 권한 축소 검토

```json
// 개발 시: "<all_urls>"
// 배포 시: 최소 권한으로 축소 고려
{
  "host_permissions": ["https://*/*", "http://*/*"],
  // 또는 Options에서 도메인 allowlist 관리
}
```

### 외부 에러 로깅 (상용 배포 시)

```typescript
// background/errors.ts - Sentry 등 외부 서비스 연동
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  // 상용 배포 시 Sentry 등 연동
  // Sentry.captureException(error, { extra: context });

  // 개발 환경에서는 콘솔 출력
  console.error('[HanTranslate Error]', error, context);
}
```
