/**
 * Cmd+B / Cmd+I for board text, which is stored as markdown: bold is `**…**`,
 * italic `*…*`, both `***…***` (see `parseInline` in board-render.ts).
 *
 * Toggling counts the stars hugging the selection — n = the fewer of the
 * two sides: bold is on when n is 2 or 3, italic when n is 1 or 3 — and adds
 * or removes that mark. Emphasis cannot span a line break in markdown, so a
 * selection over several lines is toggled line by line.
 */

import { type Run, parseInline } from "./board-render";

export type Emphasis = "bold" | "italic";

const MARK: Record<Emphasis, string> = { bold: "**", italic: "*" };

function starsBefore(s: string, at: number): number {
  let n = 0;
  while (at - n - 1 >= 0 && s[at - n - 1] === "*") n++;
  return n;
}

function starsAfter(s: string, at: number): number {
  let n = 0;
  while (at + n < s.length && s[at + n] === "*") n++;
  return n;
}

function isOn(kind: Emphasis, n: number): boolean {
  return kind === "bold" ? n === 2 || n >= 3 : n === 1 || n >= 3;
}

/** Toggles one line's `[start, end)` (already trimmed of its own stars). */
function toggleSpan(
  line: string,
  start: number,
  end: number,
  kind: Emphasis,
): { text: string; start: number; end: number } {
  const n = Math.min(starsBefore(line, start), starsAfter(line, end));
  const mark = MARK[kind];
  if (isOn(kind, n)) {
    const k = mark.length;
    return {
      text: line.slice(0, start - k) + line.slice(start, end) + line.slice(end + k),
      start: start - k,
      end: end - k,
    };
  }
  return {
    text: line.slice(0, start) + mark + line.slice(start, end) + mark + line.slice(end),
    start: start + mark.length,
    end: end + mark.length,
  };
}

/** Toggles emphasis on `value`'s selection; returns the new text and the
 *  selection to restore. An empty selection inserts a pair with the caret
 *  between, ready to type into. */
export function toggleEmphasis(
  value: string,
  selStart: number,
  selEnd: number,
  kind: Emphasis,
): { value: string; start: number; end: number } {
  if (selStart === selEnd) {
    const r = toggleSpan(value, selStart, selEnd, kind);
    return { value: r.text, start: r.start, end: r.end };
  }
  let out = "";
  let start = selStart;
  let end = selEnd;
  let offset = 0;
  let lineStart = 0;
  for (const line of value.split("\n")) {
    const lineEnd = lineStart + line.length;
    const a = Math.max(selStart, lineStart);
    const b = Math.min(selEnd, lineEnd);
    let next = line;
    if (a < b && line.slice(a - lineStart, b - lineStart).trim()) {
      // Toggle the words, not the spaces or stars at the selection's edges.
      let s = a - lineStart;
      let e = b - lineStart;
      while (s < e && /[\s*]/.test(line[s])) s++;
      while (e > s && /[\s*]/.test(line[e - 1])) e--;
      const r = toggleSpan(line, s, e, kind);
      next = r.text;
      const delta = next.length - line.length;
      if (selStart >= lineStart && selStart <= lineEnd) start = lineStart + offset + r.start;
      if (selEnd >= lineStart && selEnd <= lineEnd) end = lineStart + offset + r.end;
      offset += delta;
    }
    out += (out || lineStart > 0 ? "\n" : "") + next;
    lineStart = lineEnd + 1;
  }
  return { value: out, start, end };
}

/** Toggles emphasis on a whole text — a shape or note selected, not open.
 *  Works on the parsed runs, not the characters, so marks already inside the
 *  text can't pair up with the new ones: if every word already has the style
 *  it comes off everywhere, otherwise the whole line gets it. */
export function toggleEmphasisAll(value: string, kind: Emphasis): string {
  const flag = kind === "bold" ? "b" : "i";
  return value
    .split("\n")
    .map((line) => {
      const runs = parseInline(line);
      const words = runs.filter((r) => r.text.trim());
      if (!words.length) return line;
      const allOn = words.every((r) => r[flag]);
      const rest = runs.map((r) => ({ ...r, [flag]: false }));
      if (allOn) return serializeRuns(rest);
      // The new style wraps the whole line; inside it, italic is written with
      // `_` under bold, so `**…*x***` never has to be untangled.
      const lead = line.match(/^\s*/)?.[0] ?? "";
      const trail = line.match(/\s*$/)?.[0] ?? "";
      const inner = serializeRuns(rest, kind === "bold" ? "_" : "*").trim();
      const mark = MARK[kind];
      return lead + mark + inner + mark + trail;
    })
    .join("\n");
}

/** Runs back to markdown, each run's spaces kept outside its marks. */
function serializeRuns(runs: Run[], italicMark = "*"): string {
  return runs
    .map((r) => {
      const core = r.text.trim();
      if (!core || (!r.b && !r.i)) return r.text;
      const lead = r.text.slice(0, r.text.indexOf(core));
      const trail = r.text.slice(r.text.indexOf(core) + core.length);
      const mark = r.b && r.i ? "***" : r.b ? "**" : italicMark;
      return lead + mark + core + mark + trail;
    })
    .join("");
}
