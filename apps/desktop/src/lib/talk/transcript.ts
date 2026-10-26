import type { EditorState } from "@codemirror/state";
import { formatClock } from "./clock";

/** A line Whisper heard: seconds from the start of the take. */
export interface Segment {
  start: number;
  end: number;
  text: string;
}

/** `[0:03](<Recordings/x.m4a#t=3>)`: a time that plays its take from there. */
export function timeLink(file: string, seconds: number): string {
  return `[${formatClock(seconds)}](<${file}#t=${Math.floor(seconds)}>)`;
}

/**
 * The take's transcript as a folded callout (SPECs/talk-notes-spec.md#the-note-after-a-stop),
 * so the words live in the note and search finds them:
 *
 *   > [!transcript]- Transcript · 12 lines · On this Mac · Whisper Small
 *   > [0:00](<Recordings/….m4a#t=0>) Okay, a few things today.
 */
export function transcriptCallout(file: string, segments: Segment[], engine: string): string {
  const count = `${segments.length} ${segments.length === 1 ? "line" : "lines"}`;
  const head = `> [!transcript]- Transcript · ${count} · ${engine}`;
  if (!segments.length) return `${head}\n> Nothing was heard.`;
  return [
    head,
    ...segments.map((s) => `> ${timeLink(file, s.start)} ${s.text.replace(/\s+/g, " ").trim()}`),
  ].join("\n");
}

/** Under the take's `![[file]]` line, or null when the embed is gone from the note. */
export function transcriptInsertion(
  state: EditorState,
  file: string,
  callout: string,
): { from: number; insert: string } | null {
  const embed = `![[${file}]]`;
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (line.text.includes(embed)) return { from: line.to, insert: `\n\n${callout}` };
  }
  return null;
}
