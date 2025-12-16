import { beforeTranslate, afterTranslate } from "./placeholder/codePlaceholder";

let translator: Translator | null = null;
let currentSourceLang: string | null = null;

export async function translate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string = "ko",
  onProgress?: (progress: number) => void,
): Promise<string> {
  if (!("Translator" in self)) {
    throw new Error("Translator API not supported");
  }

  // 1. beforeTranslate: code 태그 → 플레이스홀더
  const { processedText, originals } = beforeTranslate(text);

  // 2. translate: 언어가 바뀌면 인스턴스 재생성
  if (!translator || currentSourceLang !== sourceLanguage) {
    translator = await Translator.create({
      sourceLanguage,
      targetLanguage,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          onProgress?.(e.loaded);
        });
      },
    });
    currentSourceLang = sourceLanguage;
  }

  const translated = await translator.translate(processedText);

  // 3. afterTranslate: 플레이스홀더 → 원본 code 태그
  return afterTranslate(translated, originals);
}
