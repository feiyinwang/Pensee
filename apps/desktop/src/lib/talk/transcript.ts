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

/** Under the take's transcript callout (or its embed, when it has none yet): where the talk's topics go. */
export function afterTranscriptInsertion(
  state: EditorState,
  file: string,
  text: string,
): { from: number; insert: string } | null {
  const embed = `![[${file}]]`;
  for (let n = 1; n <= state.doc.lines; n++) {
    if (!state.doc.line(n).text.includes(embed)) continue;
    let last = state.doc.line(n);
    let k = n + 1;
    while (k <= state.doc.lines && state.doc.line(k).text.trim() === "") k++;
    if (k <= state.doc.lines && /^\s*>\s*\[!transcript\]/.test(state.doc.line(k).text)) {
      while (k <= state.doc.lines && /^\s*>/.test(state.doc.line(k).text))
        last = state.doc.line(k++);
    }
    return { from: last.to, insert: `\n\n${text}` };
  }
  return null;
}

/** A take's transcript as the note holds it: the callout under `![[file]]`, read back. */
export function readTranscript(
  doc: string,
  file: string,
): { engine: string; segments: Segment[] } | null {
  const lines = doc.split("\n");
  const at = lines.findIndex((l) => l.includes(`![[${file}]]`));
  if (at < 0) return null;
  let i = at + 1;
  while (i < lines.length && !lines[i]!.trim()) i++;
  const head = /^\s*>\s*\[!transcript\][+-]?\s*(.*)$/.exec(lines[i] ?? "");
  if (!head) return null;
  const engine = head[1]!.split(" · ").slice(2).join(" · ");
  const segments: Segment[] = [];
  for (i++; i < lines.length && /^\s*>/.test(lines[i]!); i++) {
    const m = /^\s*>\s*\[[^\]]*\]\(<?[^)>]*#t=(\d+(?:\.\d+)?)>?\)\s*(.*)$/.exec(lines[i]!);
    if (m) segments.push({ start: Number(m[1]), end: Number(m[1]), text: m[2]! });
  }
  return { engine, segments };
}
