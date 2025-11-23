# Chrome Built-in AI 번역 익스텐션 구현 계획

## 1. 디렉토리 구조 재설계

```
src/
├── background/
│   ├── index.ts                    # Service Worker 진입점
│   ├── languageDetector.ts         # LanguageDetector API 래퍼
│   └── translator.ts               # Translator API 래퍼
├── content/
│   ├── index.tsx                   # Content Script 진입점
│   ├── domExtractor.ts             # DOM에서 텍스트 추출
│   └── domReplacer.ts              # 번역된 텍스트로 DOM 교체
├── popup/
│   ├── index.tsx                   # Popup 진입점
│   ├── App.tsx                     # 메인 Popup 컴포넌트
│   └── components/
│       ├── TranslateButton.tsx     # 번역 시작 버튼
│       ├── ProgressBar.tsx         # 모델 다운로드 진행률
│       └── StatusMessage.tsx       # 상태 메시지 표시
├── shared/
│   ├── types.ts                    # 공유 타입 정의
│   └── messages.ts                 # 메시지 타입 및 상수
└── options.tsx                     # 기존 Options 페이지 유지
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

## 3. 메시지 통신 구조

| 방향 | 메시지 타입 | 용도 |
|------|------------|------|
| Popup → Background | `START_TRANSLATION` | 번역 시작 요청 |
| Background → Popup | `MODEL_DOWNLOAD_PROGRESS` | 모델 다운로드 진행률 |
| Background → Popup | `TRANSLATION_STATUS` | 번역 상태 업데이트 |
| Background → Content | `GET_PAGE_CONTENT` | 페이지 텍스트 요청 |
| Content → Background | `PAGE_CONTENT` | 페이지 텍스트 응답 |
| Background → Content | `REPLACE_CONTENT` | 번역된 텍스트로 DOM 교체 |

## 4. 구현 단계

### Step 1: 기반 설정
- `@types/dom-chromium-ai` 패키지 설치
- `manifest.json` 권한 업데이트 (필요시)
- 디렉토리 구조 생성
- 공유 타입 및 메시지 상수 정의

### Step 2: Background Service Worker
- LanguageDetector 인스턴스 생성 및 관리
- Translator 인스턴스 생성 및 관리
- 모델 다운로드 진행률 이벤트 처리
- `translateStreaming()` 을 통한 청크 단위 번역
- Popup/Content Script와 메시지 통신

### Step 3: Content Script
- 페이지 DOM에서 텍스트 노드 추출
- 번역 대상 요소 식별 (body 내 텍스트)
- 번역된 텍스트로 DOM 교체
- Background와 메시지 통신

### Step 4: Popup UI (shadcn/ui 활용)
- 번역 시작 버튼 (`Button`, `Spinner`)
- 모델 다운로드 진행률 표시 (`Progress`, `Card`)
- 언어 감지 결과 표시 (`Badge`)
- 번역 진행률 및 완료 상태 표시 (`Alert`)

### Step 5: Webpack 설정 업데이트
- 새 디렉토리 구조에 맞게 entry point 수정

## 5. 핵심 API 사용 패턴

### LanguageDetector (background)

```typescript
// Feature detection
if (!('LanguageDetector' in self)) {
  throw new Error('Language Detector API is not supported');
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
  throw new Error('Translator API is not supported');
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

## 6. manifest.json 업데이트 사항

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
    "service_worker": "js/background.js"
  },

  "permissions": ["storage", "activeTab"],
  "host_permissions": ["<all_urls>"]
}
```

## 7. 예상 작업 순서

1. [ ] 타입 패키지 설치 (`@types/dom-chromium-ai`)
2. [ ] 공유 타입/메시지 정의 (`src/shared/`)
3. [ ] Background 모듈 구현 (`src/background/`)
4. [ ] Content Script 모듈 구현 (`src/content/`)
5. [ ] shadcn/ui 컴포넌트 설치 (`button`, `progress`, `card`, `badge`, `alert`, `spinner`)
6. [ ] Popup UI 컴포넌트 구현 (`src/popup/components/`)
7. [ ] Popup 메인 레이아웃 구현 (`src/popup/App.tsx`)
8. [ ] Webpack 설정 업데이트
9. [ ] 통합 테스트

## 8. 주요 고려사항

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
- 스크립트, 스타일 등 번역 불필요 요소 제외
- 번역 후 원본 DOM 구조 보존하며 텍스트만 교체

### 확장성
- 모듈화된 구조로 향후 기능 추가 용이
- shadcn/ui 기반 컴포넌트 구조
- 메시지 타입 중앙 관리로 유지보수성 향상

## 9. shadcn/ui 컴포넌트 활용 계획

### 설치

```bash
# 필요한 컴포넌트 설치
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

### 디렉토리 구조 (업데이트)

```
src/
├── popup/
│   ├── index.tsx                   # Popup 진입점
│   ├── App.tsx                     # 메인 Popup 컴포넌트
│   └── components/
│       ├── TranslateButton.tsx     # Button + Spinner 조합
│       ├── DownloadProgress.tsx    # Progress + Card 조합
│       ├── LanguageBadge.tsx       # Badge 래퍼
│       └── StatusAlert.tsx         # Alert 래퍼
├── components/
│   └── ui/                         # shadcn/ui 컴포넌트
│       ├── button.tsx
│       ├── progress.tsx
│       ├── card.tsx
│       ├── badge.tsx
│       ├── alert.tsx
│       └── spinner.tsx
└── lib/
    └── utils.ts                    # cn() 유틸리티
```

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
  // ... 추가 언어
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
    // Background로부터 메시지 수신
    const listener = (message: any) => {
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
3. **다크 모드**: `prefers-color-scheme` 미디어 쿼리 또는 클래스 기반 다크 모드 지원 가능
