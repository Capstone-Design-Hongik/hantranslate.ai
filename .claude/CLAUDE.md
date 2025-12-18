# CLAUDE.md

이 파일은 Claude Code가 프로젝트를 이해하는 데 도움이 되는 컨텍스트를 제공합니다.

## 개요

**HanTranslate.ai**는 Chrome Built-in AI(Translator API, LanguageDetector API)를 활용한 한국어 번역 Chrome 익스텐션입니다.

## 작업 방식

### 작업 시작 전 설정

> **필수**: 작업 세션 시작 시 `CONTEXT.md` 파일 존재 여부를 확인하세요.

#### A. CONTEXT.md가 존재하는 경우

1. `CONTEXT.md` 파일을 읽어 요구사항, 구현 계획, 이전 세션 기록 등을 파악
2. 마지막 세션 번호 + 1로 새 세션 번호를 설정. **이 번호를 기억하세요.**
3.`CONTEXT.md`에 새 세션 섹션을 추가하고 작업을 진행

#### B. CONTEXT.md가 존재하지 않는 경우

1. `create-issue` 서브에이전트 호출 → `ISSUE.md` 생성
2. `create-context` 서브에이전트 호출 → `CONTEXT.md` 생성
3. 구현 계획 수립 → 사용자 승인 → `CONTEXT.md` 업데이트 → 구현 작업 수행

> **필수**: 현재 세션 번호를 기억하세요.

### 작업 진행상황 기록

> **필수**: 각 작업 단위가 완료될 때마다 `CONTEXT.md`의 현재 번호 세션 기록에 진행상황을 업데이트합니다.

- 주요 작업 완료 시점마다, 대화에서 논의한 내용 및 작업한 내용을 기록
- 어떤 과정을 통해 진행되었는지 알 수 있도록 충분한 정보 제공 (ex: 발생한 문제, 대화 내용, 변경사항 등)

## 기술 스택

- **Runtime**: Chrome Extension Manifest V3
- **Language**: TypeScript 5.x
- **UI**: React 19
- **Build**: Webpack 5
- **Package Manager**: pnpm
- **Styling**: Tailwind CSS 4 (향후 확장용)
- **AI API**: Chrome Built-in AI (`@types/dom-chromium-ai`)

## 디렉토리 구조

```
src/
├── background/              # Service Worker
│   ├── index.ts             # 진입점, 메시지 리스너
│   ├── translator.ts        # Translator API 래퍼 (플레이스홀더 통합)
│   ├── languageDetector.ts  # LanguageDetector API 래퍼
│   ├── messageHandler.ts    # 메시지 처리 로직
│   └── placeholder/         # 번역 전후처리 (태그 보호)
│       └── codePlaceholder.ts
├── content/                 # Content Script
│   ├── index.ts             # 진입점, 메시지 리스너
│   ├── domExtractor.ts      # DOM 블록 추출 (innerHTML)
│   └── domReplacer.ts       # 번역된 HTML로 블록 교체
├── popup/                   # Popup UI
│   ├── index.tsx            # 진입점
│   └── App.tsx              # 메인 컴포넌트
├── shared/                  # 공유 모듈
│   ├── types.ts             # 공유 타입 정의
│   └── messages.ts          # 메시지 타입 정의
└── lib/                     # 유틸리티
    └── utils.ts             # shadcn/ui cn() 함수

public/                      # 정적 파일 (dist로 복사됨)
├── manifest.json
├── popup.html
└── icon.png

dist/                        # 빌드 출력 (Chrome에 로드)
```

## 명령어

```bash
pnpm build      # 프로덕션 빌드 → dist/
pnpm watch      # 개발 모드 (파일 변경 감지)
pnpm clean      # dist 폴더 삭제
pnpm test       # Jest 테스트 실행
pnpm style      # Prettier 포맷팅
```

## 아키텍처

### 메시지 통신 흐름

1. **Popup → Background**: `START_TRANSLATION` 메시지 전송
2. **Background → Content Script**: `GET_TEXT_NODES` 메시지 전송
3. **Content Script → Background**: `TEXT_NODES` 응답
   - DOM 블록 요소의 innerHTML 배열 (`texts[]`) 반환
   - 인라인 태그(`<a>`, `<strong>` 등)가 보존됨
4. **Background**: 언어 감지
   - 언어 감지 (LanguageDetector API)
5. **Background ↔ Content Script**: 청크 단위 번역 및 교체 반복
   - 각 블록별로 번역 수행 (Translator API)
   - 번역 완료 즉시 `REPLACE_TEXT` 메시지 전송
   - Content Script가 해당 블록의 innerHTML 교체
6. **Background → Popup**: `STATUS` 응답 (`completed` 또는 `error`)

### 타입 정의

**`shared/types.ts`**
- `TranslationStatus`: 번역 상태
  - `idle` | `detecting` | `downloading` | `translating` | `completed` | `error`
- `ModelType`: 다운로드 모델 종류
  - `detector` | `translator`

**`shared/messages.ts`**
- `PopupMessage` (Popup → Background)
  - `{ type: 'START_TRANSLATION' }`: 번역 시작 요청
  - `{ type: 'GET_STATUS' }`: 현재 상태 조회
- `BackgroundResponse` (Background → Popup)
  - `{ type: 'STATUS', status, error? }`: 상태 응답
  - `{ type: 'DOWNLOAD_PROGRESS', model, progress }`: 모델 다운로드 진행률
  - `{ type: 'LANGUAGE_DETECTED', language }`: 감지된 언어
- `ContentMessage` (Background → Content)
  - `{ type: 'GET_TEXT_NODES' }`: 블록 요소 추출 요청
  - `{ type: 'REPLACE_TEXT', replacements[] }`: HTML 교체 요청
- `ContentResponse` (Content → Background)
  - `{ type: 'TEXT_NODES', texts[] }`: 추출된 블록 innerHTML 배열
  - `{ type: 'REPLACE_DONE' }`: 교체 완료


## 참고 문서

- **BUILD.md**: 빌드 시스템 상세 (Webpack, TypeScript, pnpm 설정)
- **PLACEHOLDER.md**: 플레이스홀더 시스템 (번역 시 태그 보호)
- **ai/CHROME_LANGUAGE_DETECTOR_API.md**: Chrome LanguageDetector API 레퍼런스
- **ai/CHROME_TRANSLATOR_API.md**: Chrome Translator API 레퍼런스
- **plan/PLAN_0.md**: MVP 구현 계획
- **plan/PLAN_1.md**: 확장 구현 계획
- **plan/PLAN_DOM_EXTRACTOR_V2.md**: DOM 추출 V2 계획 (블록 기반)
- **plan/PLAN_EXTRACTION_STRATEGY.md**: 추출 전략 분석
- **plan/PLAN_REFACTOR_DOM_EXTRACTOR.md**: DOM 추출기 리팩토링 계획
