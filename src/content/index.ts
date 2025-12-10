import { extractTextNodes } from "./domExtractor";
import { replaceTextNodes } from "./domReplacer";
import type { ContentMessage, ContentResponse } from "../shared/messages";

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse) => {
    if (message.type === "GET_TEXT_NODES") {
      const texts = extractTextNodes();
      sendResponse({ type: "TEXT_NODES", texts } as ContentResponse);
    }

    if (message.type === "REPLACE_TEXT") {
      replaceTextNodes(message.replacements);
      sendResponse({ type: "REPLACE_DONE" } as ContentResponse);
    }

    return true;
  },
);
