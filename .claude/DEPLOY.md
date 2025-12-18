# DEPLOY.md

릴리즈 및 배포 자동화에 대한 문서입니다.

## 개요

이 프로젝트는 [release-please](https://github.com/googleapis/release-please)를 사용하여 릴리즈를 자동화합니다. Conventional Commits 기반으로 버전을 자동 결정하고, CHANGELOG를 생성하며, GitHub Release에 익스텐션 ZIP 파일을 첨부합니다.

## 관련 파일

| 파일 | 설명 |
|------|------|
| `release-please-config.json` | release-please 설정 |
| `.release-please-manifest.json` | 현재 버전 추적 |
| `.github/workflows/release.yml` | 릴리즈 워크플로우 |
| `.github/workflows/ci.yml` | CI 워크플로우 (릴리즈 커밋 스킵 조건 포함) |

## 릴리즈 플로우

```
1. Conventional Commits로 커밋 (feat:, fix:, feat!: 등)
2. main 브랜치에 push/merge
3. release-please가 Release PR 자동 생성
   - package.json 버전 범프
   - public/manifest.json 버전 범프
   - CHANGELOG.md 자동 생성
4. Release PR 머지
5. GitHub Release 생성 + 태그 (v0.2.0)
6. 빌드 및 아티팩트 업로드
   - pnpm build → dist/
   - ZIP 생성 → hantranslate-ai-{version}.zip
   - gh release upload로 GitHub Release에 ZIP 첨부
7. 사용자가 릴리즈에서 ZIP 다운로드 → 수동 설치
```

## 설정 상세

### release-please-config.json

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "include-component-in-tag": false,
  "packages": {
    ".": {
      "changelog-path": "CHANGELOG.md",
      "extra-files": [
        {
          "type": "json",
          "path": "public/manifest.json",
          "jsonpath": "$.version"
        }
      ]
    }
  }
}
```

**설정 항목:**
- `release-type: node`: package.json 기반 Node.js 프로젝트
- `include-component-in-tag: false`: 태그에 컴포넌트명 미포함 (v0.2.0 형식)
- `extra-files`: package.json 외에 버전 동기화할 파일
  - `public/manifest.json`의 `version` 필드를 자동 업데이트

### .release-please-manifest.json

```json
{
  ".": "0.1.0"
}
```

현재 버전을 추적합니다. release-please가 릴리즈 시 자동 업데이트합니다.

### release.yml 워크플로우

```yaml
name: Release

on:
  push:
    branches:
      - main

permissions:
  contents: write      # 릴리즈 생성, 아티팩트 업로드
  issues: write        # release-please 이슈 관리
  pull-requests: write # Release PR 생성/업데이트

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        id: release

      # release_created가 true일 때만 아래 단계 실행
      - uses: actions/checkout@v4
        if: ${{ steps.release.outputs.release_created }}

      # pnpm, node 설정, 의존성 설치, 빌드...

      - name: Package extension
        if: ${{ steps.release.outputs.release_created }}
        run: |
          cd dist
          zip -r ../hantranslate-ai-${{ steps.release.outputs.version }}.zip .

      - name: Upload Release Artifact
        if: ${{ steps.release.outputs.release_created }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh release upload ${{ steps.release.outputs.tag_name }} hantranslate-ai-${{ steps.release.outputs.version }}.zip
```

**주요 포인트:**
- `release-please-action@v4`: Release PR 생성/머지 처리
- `steps.release.outputs.release_created`: 릴리즈가 생성되었을 때만 true
- `steps.release.outputs.version`: 릴리즈 버전 (예: 0.2.0)
- `steps.release.outputs.tag_name`: 태그명 (예: v0.2.0)
- `gh release upload`: GitHub CLI로 아티팩트 첨부

### ci.yml 릴리즈 커밋 스킵

```yaml
jobs:
  build-and-test:
    if: "!contains(github.event.head_commit.message, 'chore: release')"
```

release-please가 생성하는 릴리즈 커밋(예: `chore: release 0.2.0`)에서 CI가 중복 실행되지 않도록 스킵합니다.

## Conventional Commits

release-please는 Conventional Commits를 분석하여 버전을 결정합니다.

| 접두사 | 버전 범프 | 예시 |
|--------|-----------|------|
| `fix:` | PATCH (0.0.x) | `fix: 번역 오류 수정` |
| `feat:` | MINOR (0.x.0) | `feat: 다크 모드 추가` |
| `feat!:` 또는 `BREAKING CHANGE:` | MAJOR (x.0.0) | `feat!: API 변경` |
| `chore:`, `docs:`, `refactor:` 등 | 버전 범프 없음 | `chore: 의존성 업데이트` |

## 아티팩트

- **태그 형식**: `v{major}.{minor}.{patch}` (예: v0.2.0)
- **ZIP 파일명**: `hantranslate-ai-{version}.zip` (예: hantranslate-ai-0.2.0.zip)
- **다운로드 위치**: GitHub Releases 페이지

## 수동 릴리즈 (비권장)

자동화된 플로우를 사용하는 것이 권장되지만, 수동으로 릴리즈가 필요한 경우:

```bash
# 1. 버전 업데이트
npm version patch  # 또는 minor, major

# 2. 빌드
pnpm build

# 3. ZIP 생성
cd dist && zip -r ../hantranslate-ai-$(node -p "require('../package.json').version").zip .

# 4. 태그 푸시
git push --follow-tags

# 5. GitHub에서 수동으로 Release 생성 및 ZIP 첨부
```

## 트러블슈팅

### Release PR이 생성되지 않음
- Conventional Commits 형식을 따르고 있는지 확인
- main 브랜치에 push가 되었는지 확인
- Actions 탭에서 워크플로우 실행 로그 확인

### 아티팩트가 릴리즈에 첨부되지 않음
- `release_created` output이 true인지 확인
- `GITHUB_TOKEN` 권한 확인 (contents: write 필요)
- 빌드가 성공적으로 완료되었는지 확인

### 버전이 manifest.json에 반영되지 않음
- `release-please-config.json`의 `extra-files` 설정 확인
- `jsonpath`가 올바른지 확인 (`$.version`)
