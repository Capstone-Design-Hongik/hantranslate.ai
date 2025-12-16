// <code>...</code> 또는 <code class="...">...</code> 매칭
const CODE_PATTERN = /<code(?:\s[^>]*)?>[\s\S]*?<\/code>/gi;

// afterTranslate용 플레이스홀더 매칭
const PLACEHOLDER_PATTERN = /<code_(\d+)>/gi;

/**
 * 번역 전처리: code 태그를 플레이스홀더로 치환
 *
 * @param text - 원본 HTML 문자열
 * @returns processedText와 복구용 originals 배열
 */
export function beforeTranslate(text: string): {
  processedText: string;
  originals: string[];
} {
  const originals: string[] = [];

  const processedText = text.replace(CODE_PATTERN, (match) => {
    originals.push(match);
    return `<code_${originals.length}>`; // 1부터 시작
  });

  return { processedText, originals };
}

/**
 * 번역 후처리: 플레이스홀더를 원본 code 태그로 복구
 *
 * @param text - 번역된 텍스트 (플레이스홀더 포함)
 * @param originals - beforeTranslate에서 반환된 원본 배열
 * @returns 복구된 텍스트
 */
export function afterTranslate(text: string, originals: string[]): string {
  // 단일 replace로 모든 플레이스홀더 처리 (대소문자 무관)
  return text.replace(PLACEHOLDER_PATTERN, (_, num) => {
    const index = parseInt(num, 10) - 1;
    return originals[index] ?? _; // 매칭 실패 시 원본 유지
  });
}
