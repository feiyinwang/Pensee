// A part of a recording, as a link: `Recordings/2026-10-27 11.32.m4a#t=6,17`
// plays that take from 0:06 to 0:17 (the Media Fragments `#t=start,end`
// form). A board node carries one as its `ln` (SPECs/talk-notes-spec.md#topic-boards):
// its play badge plays only that part. Pure text functions.

export interface AudioClip {
  /** Workspace-relative, as `Recordings/…` is written in notes. */
  path: string;
  start: number;
  end: number;
}

const CLIP_RE =
  /^([^#]+\.(?:m4a|mp3|wav|ogg|oga|aac|flac|webm|mp4))#t=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/i;

export function parseAudioClip(link: string): AudioClip | null {
  const m = CLIP_RE.exec(link.trim());
  if (!m) return null;
  const start = Number(m[2]);
  const end = Number(m[3]);
  return end > start ? { path: m[1]!, start, end } : null;
}

export function audioClipLink(path: string, start: number, end: number): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return `${path}#t=${r(start)},${r(end)}`;
}
