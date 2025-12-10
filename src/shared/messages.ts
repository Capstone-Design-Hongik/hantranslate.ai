import type { TranslationStatus, ModelType } from "./types";

// Popup → Background
export type PopupMessage =
  | { type: "START_TRANSLATION" }
  | { type: "GET_STATUS" };

// Background → Popup (응답)
export type BackgroundResponse =
  | { type: "STATUS"; status: TranslationStatus; error?: string }
  | { type: "DOWNLOAD_PROGRESS"; model: ModelType; progress: number }
  | { type: "LANGUAGE_DETECTED"; language: string };

// Background → Content
export type ContentMessage =
  | { type: "GET_TEXT_NODES" }
  | {
      type: "REPLACE_TEXT";
      replacements: Array<{ index: number; text: string }>;
    };

// Content → Background
export type ContentResponse =
  | { type: "TEXT_NODES"; texts: string[] }
  | { type: "REPLACE_DONE" };
