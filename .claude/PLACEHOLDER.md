# 플레이스홀더 시스템

Chrome Translator API가 특정 태그를 손상시키는 문제를 해결하기 위한 전처리/후처리 시스템.

## 문제

Chrome Translator API가 `<code>` 태그를 손상시킴:
- 닫는 태그 누락: `<code>npm install</code>` → `<code>npm install`
- 대소문자 변경: `<code>String</code>` → `<code>string</code>`

## 해결 방법

번역 전 `<code>` 태그를 플레이스홀더(`<code_1>`, `<code_2>`)로 치환하고, 번역 후 원본으로 복구.

## 파이프라인

```
원본 HTML → beforeTranslate() → Translator API → afterTranslate() → 복구된 HTML
```

1. **beforeTranslate**: `<code>...</code>` → `<code_N>` 치환, 원본 배열 반환
2. **translate**: Chrome Translator API 호출
3. **afterTranslate**: `<code_N>` → 원본 code 태그 복구

## 파일

- `src/background/placeholder/codePlaceholder.ts`: beforeTranslate, afterTranslate 함수
- `src/background/translator.ts`: 파이프라인 통합

## 확장

다른 태그 보호가 필요하면 동일 패턴으로 새 플레이스홀더 모듈 추가:
- `prePlaceholder.ts` (pre 태그용)
- `kbdPlaceholder.ts` (kbd 태그용)
