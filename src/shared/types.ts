// 번역 상태
export type TranslationStatus =
  | "idle"
  | "detecting"
  | "downloading"
  | "translating"
  | "completed"
  | "error";

// 다운로드 모델 종류
export type ModelType = "detector" | "translator";
