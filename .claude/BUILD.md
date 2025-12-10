# BUILD.md

빌드 시스템 및 설정 파일에 대한 상세 문서입니다.

## 빌드 시스템 개요

1. **`pnpm build`** 실행
2. **Webpack** (`webpack.prod.js`)
   - **Entry Points**
     - `popup/index.tsx` → `popup.js` + `vendor.js`
     - `background/index.ts` → `background.js`
     - `content/index.ts` → `content.js`
   - **Loaders**
     - `ts-loader`: TypeScript → JavaScript
     - `css-loader` + `postcss-loader`: CSS + Tailwind
   - **Plugins**
     - `CopyPlugin`: `public/` → `dist/`
3. **빌드 출력** (`dist/`)
   - `js/`
     - `vendor.js` (185KB) - React, React DOM
     - `popup.js` (2.8KB)
     - `background.js` (2.5KB)
     - `content.js` (783B)
   - `manifest.json`
   - `popup.html`
   - `icon.png`

---

## pnpm

### 버전 고정

```json
// package.json
{
  "packageManager": "pnpm@10.23.0"
}
```

- `packageManager` 필드로 pnpm 버전 고정
- Corepack 활성화 시 자동으로 해당 버전 사용

### 스크립트

| 명령어 | 설명 |
|--------|------|
| `pnpm build` | 프로덕션 빌드 |
| `pnpm watch` | 개발 모드 (파일 변경 감지) |
| `pnpm clean` | dist 폴더 삭제 |
| `pnpm test` | Jest 테스트 실행 |
| `pnpm style` | Prettier 포맷팅 |

---

## Webpack

### 설정 파일 구조

```
webpack/
├── webpack.common.js  # 공통 설정 (entry, loaders, plugins)
├── webpack.dev.js     # 개발 모드 (source map 활성화)
└── webpack.prod.js    # 프로덕션 모드 (최적화)
```

`webpack-merge`를 사용하여 공통 설정을 dev/prod에서 확장합니다.

### Entry Points

```javascript
// webpack.common.js
entry: {
  popup: path.join(srcDir, 'popup/index.tsx'),
  background: path.join(srcDir, 'background/index.ts'),
  content: path.join(srcDir, 'content/index.ts'),
}
```

각 entry는 Chrome Extension의 컴포넌트에 대응합니다:
- `popup`: 팝업 UI (React 앱)
- `background`: Service Worker
- `content`: 웹페이지에 주입되는 스크립트

### splitChunks 전략

```javascript
// webpack.common.js
optimization: {
  splitChunks: {
    name: "vendor",
    chunks(chunk) {
      // background와 content는 독립 실행되어야 함
      return chunk.name !== 'background' && chunk.name !== 'content';
    }
  },
}
```

**왜 이렇게 설정하는가?**

| Entry | vendor.js 포함 | 이유 |
|-------|---------------|------|
| popup | O | HTML에서 `<script>` 태그로 순차 로드 가능 |
| background | X | Service Worker는 단일 파일로 실행 (import 불가) |
| content | X | 웹페이지에 주입 시 독립 실행 필요 |

**결과:**
- `popup.js`는 `vendor.js` (React 등)에 의존
- `background.js`, `content.js`는 자체적으로 모든 코드 포함

### 로더 설정

```javascript
// webpack.common.js
module: {
  rules: [
    {
      test: /\.tsx?$/,
      use: "ts-loader",
      exclude: /node_modules/,
    },
    {
      test: /\.css$/,
      use: [
        "style-loader",   // CSS를 DOM에 주입
        "css-loader",     // CSS를 JS 모듈로 변환
        "postcss-loader", // Tailwind 처리
      ],
    },
  ],
}
```

### Path Alias

```javascript
// webpack.common.js
resolve: {
  extensions: [".ts", ".tsx", ".js"],
  alias: {
    "@": path.join(__dirname, "..", "src"),
  },
}
```

`@/shared/types`처럼 절대 경로로 import 가능합니다.

### CopyPlugin

```javascript
// webpack.common.js
plugins: [
  new CopyPlugin({
    patterns: [{ from: ".", to: "../", context: "public" }],
  }),
]
```

`public/` 폴더의 모든 파일을 `dist/`로 복사합니다:
- `manifest.json`
- `popup.html`
- `icon.png`

### 개발 모드 vs 프로덕션 모드

```javascript
// webpack.dev.js
module.exports = merge(common, {
  devtool: 'inline-source-map',  // 디버깅용 소스맵
  mode: 'development'
});

// webpack.prod.js
module.exports = merge(common, {
  mode: 'production'  // 코드 최소화, 트리 쉐이킹
});
```

---

## TypeScript

### tsconfig.json

```json
{
  "compilerOptions": {
    "strict": true,              // 엄격한 타입 검사
    "target": "es6",             // ES6로 컴파일
    "moduleResolution": "bundler", // Webpack과 호환되는 모듈 해석
    "module": "ES6",             // ES 모듈 사용
    "esModuleInterop": true,     // CommonJS/ES 모듈 호환
    "sourceMap": false,          // 소스맵 비활성화 (Webpack이 처리)
    "rootDir": "src",
    "outDir": "dist/js",
    "noEmitOnError": true,       // 에러 시 빌드 중단
    "jsx": "react-jsx",          // React 17+ JSX 변환
    "typeRoots": ["node_modules/@types"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]         // Path alias
    }
  }
}
```

**주요 설정 설명:**

| 옵션 | 값 | 설명 |
|------|-----|------|
| `jsx` | `"react-jsx"` | React 17+의 새 JSX 변환. `import React` 불필요 |
| `moduleResolution` | `"bundler"` | Webpack 번들러와 호환되는 모듈 해석 방식 |
| `sourceMap` | `false` | Webpack이 소스맵 생성을 담당하므로 비활성화 |

### tsconfig.test.json

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "moduleResolution": "node"  // Jest는 Node.js 방식 필요
  }
}
```

Jest 실행 시 `moduleResolution`을 `node`로 변경합니다. `bundler` 모드는 Jest와 호환되지 않습니다.

---

## PostCSS / Tailwind CSS

### postcss.config.mjs

```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

Tailwind CSS 4.x는 `@tailwindcss/postcss` 플러그인을 사용합니다.

### CSS 처리 파이프라인

1. `.css` 파일
2. `postcss-loader` - Tailwind 처리
3. `css-loader` - JS 모듈로 변환
4. `style-loader` - 런타임에 DOM 주입

---

## Jest

### jest.config.js

```javascript
module.exports = {
  roots: ["src"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }]
  },
};
```

- `roots`: 테스트 파일 검색 경로
- `transform`: `.ts` 파일을 `ts-jest`로 변환
- `tsconfig.test.json`: Jest용 TypeScript 설정 사용

---

## manifest.json과 빌드 출력

### manifest.json 구조

```json
{
  "manifest_version": 3,

  "background": {
    "service_worker": "js/background.js",  // Webpack 출력과 일치
    "type": "module"
  },

  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["js/content.js"]  // Webpack 출력과 일치
  }],

  "action": {
    "default_popup": "popup.html"  // public/에서 복사됨
  }
}
```

### popup.html과 vendor.js

```html
<!-- public/popup.html -->
<script src="js/vendor.js"></script>  <!-- React 등 공유 라이브러리 -->
<script src="js/popup.js"></script>   <!-- Popup 앱 코드 -->
```

`vendor.js`가 먼저 로드되어야 `popup.js`가 정상 작동합니다.

---

## 빌드 출력 구조

```
dist/
├── js/
│   ├── vendor.js           # 공유 라이브러리 (React, React DOM)
│   ├── vendor.js.LICENSE.txt
│   ├── popup.js            # Popup UI
│   ├── background.js       # Service Worker
│   └── content.js          # Content Script
├── manifest.json           # Chrome Extension 매니페스트
├── popup.html              # Popup HTML
├── icon.png                # 확장 프로그램 아이콘
└── options.html            # (미사용, 향후 삭제 가능)
```

---

## 새 Entry 추가하기

새로운 entry point를 추가하려면:

1. **webpack.common.js**에 entry 추가:
   ```javascript
   entry: {
     // ...기존 entries
     newEntry: path.join(srcDir, 'newEntry/index.ts'),
   }
   ```

2. **splitChunks** 설정 검토:
   - 독립 실행이 필요하면 `chunks()` 함수에서 제외
   - HTML에서 로드할 수 있으면 vendor 포함 가능

3. **manifest.json** 업데이트 (필요 시)

---

## 트러블슈팅

### "React refers to a UMD global" 에러

**원인:** `jsx: "react"` 설정에서는 매 파일마다 `import React from 'react'` 필요

**해결:** `tsconfig.json`에서 `"jsx": "react-jsx"` 사용

### Jest에서 모듈 해석 실패

**원인:** `moduleResolution: "bundler"`는 Jest와 호환 안 됨

**해결:** `tsconfig.test.json`에서 `"moduleResolution": "node"` 사용

### Content Script에서 React 사용 불가

**원인:** `splitChunks`로 React가 `vendor.js`에 분리됨

**해결:** content script는 splitChunks에서 제외 (현재 설정대로)
