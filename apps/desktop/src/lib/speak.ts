import { showEditorNotice } from "@/components/editor-area/editor-notice-store";

// Say a word aloud with the system's voices (Web Speech API, which macOS's
// WebKit backs with its built-in voices), for Define on a single word in a
// book (SPECs/book-reader-spec.md).

/** The language to voice `text` in, from its script; English otherwise. */
export function speechLanguage(text: string): string {
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return "ja-JP";
  if (/\p{Script=Hangul}/u.test(text)) return "ko-KR";
  if (/\p{Script=Han}/u.test(text)) return "zh-CN";
  if (/\p{Script=Cyrillic}/u.test(text)) return "ru-RU";
  return "en-US";
}

export function speak(text: string): void {
  if (typeof speechSynthesis === "undefined") {
    showEditorNotice("This Mac can't play pronunciations here.");
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = speechLanguage(text);
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
}
