# hantranslate.ai

Chrome Built-in AI(Translator API, LanguageDetector API)를 활용한 한국어 번역 Chrome 익스텐션입니다.

## 설치 방법

### 사전 요구사항

이 익스텐션은 Chrome Built-in AI(Translator API, Language Detector API)를 사용합니다.

**브라우저**
- Chrome 138 이상 (Stable 버전에서 지원)
- 데스크톱 전용 (모바일 미지원)

**운영체제**
- Windows 10 / 11
- macOS 13+ (Ventura 이상)
- Linux
- ChromeOS

**하드웨어**
- 저장 공간: Chrome 프로필 볼륨에 22GB 이상 여유 공간
- GPU: 4GB VRAM 초과 또는 CPU: 16GB RAM + 4코어 이상
- 네트워크: 무제한 또는 비종량제 연결 (최초 모델 다운로드 시)

### 익스텐션 수동 설치

1. [GitHub Releases](https://github.com/user/hantranslate.ai/releases) 페이지에서 최신 버전의 `hantranslate-ai-x.x.x.zip` 파일 다운로드
2. 다운로드한 ZIP 파일 압축 해제
3. Chrome에서 `chrome://extensions` 접속
4. 우측 상단의 **개발자 모드** 활성화
5. **압축해제된 확장 프로그램을 로드합니다** 클릭
6. 압축 해제한 폴더 선택

## 개발

```bash
# 의존성 설치
pnpm install

# 개발 모드 (파일 변경 감지)
pnpm watch

# 프로덕션 빌드
pnpm build

# 테스트 실행
pnpm test
```