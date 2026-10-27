import { convertFileSrc } from "@tauri-apps/api/core";

// Plays one part of a recording and stops at its end: a board node's audio
// clip (audio-clips.ts). One clip at a time; pressing the playing clip again
// stops it.

let current: { audio: HTMLAudioElement; key: string } | null = null;

function stop(): void {
  current?.audio.pause();
  current = null;
}

/** Plays `absolute` from `start` to `end` seconds; returns false when it stopped the same clip instead. */
export function playClip(absolute: string, start: number, end: number): boolean {
  const key = `${absolute}#${start},${end}`;
  const same = current?.key === key;
  stop();
  if (same) return false;
  const audio = new Audio(convertFileSrc(absolute));
  current = { audio, key };
  audio.addEventListener("timeupdate", () => {
    if (audio.currentTime >= end && current?.audio === audio) stop();
  });
  audio.addEventListener("ended", () => current?.audio === audio && stop());
  audio.addEventListener(
    "loadedmetadata",
    () => {
      audio.currentTime = start;
      audio.play().catch((error: unknown) => {
        console.error("[clip] couldn't play", absolute, error);
        if (current?.audio === audio) stop();
      });
    },
    { once: true },
  );
  audio.addEventListener("error", () => {
    console.error("[clip] couldn't load", absolute, audio.error);
    if (current?.audio === audio) stop();
  });
  return true;
}
