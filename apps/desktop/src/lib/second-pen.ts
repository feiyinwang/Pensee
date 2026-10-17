import { BLOCK_ID_AT_END_RE } from "./block-refs";
import { formatVideoTime, parseVideoPinId } from "./video-pins";
import { TRANSCRIPT_BLOCK } from "./video-transcript";
import type { Paper } from "./tauri";

// The second pen (SPECs/second-pen-spec.md): an AI that writes one line at a
// time under the line you're on. Pure text: its ids, where its lines go, the
// answer flow read back from the document (no hidden session), the prompts
// and the reply clean-up. The editor wiring is
// `components/editor-area/second-pen.ts`; the Claude call is
// `second-pen-agent.ts`.

/* ------------------------------------------------------------------ ids */

/** What a pen line is: an answer still sealed (`s`) or open (`r`, also each
 *  of its points once combined with your take), its comparison with your take
 *  (`v`, written by the earlier Answer), the two lines of a check, labelled
 *  for what the line asks (`p`, then `n`, which your call waits under), or
 *  an echo of an earlier note (`e`), or a line Organize wrote: a topic's
 *  theory, how it works, its rules (`g`). The earlier pen's lines (a quiz question
 *  `q`, a question `a`, a hint `h`, a check `c`, a fact `f`, a mix `m`) keep
 *  their ink. */
export type PenKind = "s" | "r" | "v" | "p" | "n" | "e" | "g" | "q" | "a" | "h" | "c" | "f" | "m";

const PEN_ID_RE = /^ai-([srvpnegqahcfm])-[a-z0-9]{4}$/;

export function penIdKind(id: string): PenKind | null {
  const match = PEN_ID_RE.exec(id);
  return match ? (match[1] as PenKind) : null;
}

/** A new id for a pen line of `kind`, unique among `taken`. */
export function newPenId(
  kind: PenKind,
  taken: ReadonlySet<string>,
  random: () => number = Math.random,
): string {
  for (;;) {
    const id = `ai-${kind}-${Math.floor(random() * 36 ** 4)
      .toString(36)
      .padStart(4, "0")}`;
    if (!taken.has(id)) return id;
  }
}

/** The pen kind of a line, from the block id at its end; null for your lines. */
export function penKindOf(line: string): PenKind | null {
  const id = BLOCK_ID_AT_END_RE.exec(line);
  return id ? penIdKind(id[1]!) : null;
}

export function penIdOf(line: string): string | null {
  const id = BLOCK_ID_AT_END_RE.exec(line);
  return id && penIdKind(id[1]!) ? id[1]! : null;
}

/* ------------------------------------------------------------- outline */

// Marker, the spaces after it, then a task's checkbox (part of the text,
// so a child lines up with the marker's text column, not past the box).
const ITEM_RE = /^([ \t]*)([-*+]|\d+[.)])([ \t]+|$)(\[[ xX]\][ \t]+)?/;

/** Leading whitespace width, a tab counting as four. */
function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

export function isItem(line: string): boolean {
  return ITEM_RE.test(line);
}

/** The column an item's text starts at; a non-item line's own indent. */
function contentColumn(line: string): number {
  const match = ITEM_RE.exec(line);
  return match
    ? indentWidth(match[1]!) + match[2]!.length + Math.max(1, match[3]!.length)
    : indentWidth(line);
}

/** The indent a child bullet of `line` takes: under an item, its text's
 *  column; under a paragraph or heading, none (a bullet on the next line). */
export function childIndent(line: string): string {
  return isItem(line) ? " ".repeat(contentColumn(line)) : "";
}

/** A line's words: no marker, no block id. */
export function itemText(line: string): string {
  const body = line.replace(ITEM_RE, "").replace(/^[ \t]+/, "");
  return body.replace(BLOCK_ID_AT_END_RE, "").trim();
}

/** Where a line's words start, as an offset into the line. */
export function bodyStart(line: string): number {
  const match = ITEM_RE.exec(line);
  return match ? match[0].length : indentWidth(line);
}

/** Where a line's words end: before its block id and trailing spaces. */
export function bodyEnd(line: string): number {
  const id = BLOCK_ID_AT_END_RE.exec(line);
  return (id ? line.slice(0, id.index) : line).trimEnd().length;
}

/** A pen line written as a plain line under a paragraph or heading, not as
 *  a bullet. Your answers to it are the bullets right after it. */
export function isPenParagraph(line: string): boolean {
  return !isItem(line) && penKindOf(line) !== null;
}

/** The last line (0-based index) of the item at `i` with its children: the
 *  following lines indented past it, up to a blank line. A pen paragraph's
 *  children are the bullets right after it. */
export function subtreeEnd(lines: readonly string[], i: number): number {
  const own = indentWidth(lines[i]!);
  const takesItems = isPenParagraph(lines[i]!);
  let j = i;
  for (; j + 1 < lines.length; j++) {
    const next = lines[j + 1]!;
    if (!next.trim()) break;
    if (!(indentWidth(next) > own || (takesItems && isItem(next)))) break;
  }
  return j;
}

/** The nearest line above `i` it hangs under, or -1 at the top level. A
 *  top-level bullet right after a pen paragraph hangs under it. */
export function parentOf(lines: readonly string[], i: number): number {
  const own = indentWidth(lines[i]!);
  for (let j = i - 1; j >= 0; j--) {
    const line = lines[j]!;
    if (!line.trim()) return -1;
    if (indentWidth(line) < own) return j;
    if (own === 0 && isItem(lines[i]!) && !isItem(line)) return isPenParagraph(line) ? j : -1;
  }
  return -1;
}

/** The direct children of the line at `i`, by index. */
export function childrenOf(lines: readonly string[], i: number): number[] {
  const end = subtreeEnd(lines, i);
  const children: number[] = [];
  for (let j = i + 1; j <= end; j = subtreeEnd(lines, j) + 1) children.push(j);
  return children;
}

/** The pen's lines under a paragraph or heading: the plain pen lines after
 *  it, each a blank line apart. Indexes, in order. */
function penParagraphsAfter(lines: readonly string[], end: number): number[] {
  const found: number[] = [];
  let j = end;
  while (j + 2 < lines.length && !lines[j + 1]!.trim() && isPenParagraph(lines[j + 2]!)) {
    found.push(j + 2);
    j = subtreeEnd(lines, j + 2);
  }
  return found;
}

/** The last line of the paragraph `i` is in (a heading is one line). */
function paragraphEnd(lines: readonly string[], i: number): number {
  let j = i;
  if (/^\s*#{1,6}\s/.test(lines[i]!)) return j;
  while (
    j + 1 < lines.length &&
    lines[j + 1]!.trim() &&
    !isItem(lines[j + 1]!) &&
    !/^\s*#{1,6}\s/.test(lines[j + 1]!)
  )
    j++;
  return j;
}

export type PenSlot =
  /** A sub-bullet: after line `after`, at `indent`. */
  | { kind: "bullet"; after: number; indent: string }
  /** A plain line after line `after`, a blank line apart (and one after
   *  when more text follows, so it never joins the next block). */
  | { kind: "line"; after: number; blankAfter: boolean };

/**
 * Where the pen's line for `anchor` goes: right under it. Under a bullet, a
 * sub-bullet, after the pen's sub-bullets already there so a second request
 * lands after the first. Under a paragraph or heading, a plain line below it,
 * after the pen's plain lines already there.
 */
export function penLineSlot(lines: readonly string[], anchor: number): PenSlot {
  const line = lines[anchor]!;
  if (isItem(line) || isPenParagraph(line)) {
    const indent = childIndent(line);
    let after = anchor;
    const children = childrenOf(lines, anchor);
    for (let c = 0; c < children.length; c++) {
      const child = children[c]!;
      if (!penKindOf(lines[child]!)) break;
      after = subtreeEnd(lines, child);
      // An answer's take sits right beside it, and the empty line where you
      // put the two together beside that: they go with the answer.
      while (c + 1 < children.length && answerBefore(lines, children[c + 1]!) >= 0) {
        after = subtreeEnd(lines, children[++c]!);
        if (c + 1 < children.length && combineAt(lines, children[c + 1]!)) {
          after = subtreeEnd(lines, children[++c]!);
        }
      }
    }
    return { kind: "bullet", after, indent };
  }
  const end = paragraphEnd(lines, anchor);
  const pens = penParagraphsAfter(lines, end);
  const after = pens.length ? subtreeEnd(lines, pens[pens.length - 1]!) : end;
  return {
    kind: "line",
    after,
    blankAfter: after + 1 < lines.length && !!lines[after + 1]!.trim(),
  };
}

/* --------------------------------------------------------- answer flow */

/** The answer (sealed `s` or open `r`) a line of yours is the take on: the
 *  line right above it at its own level, or the plain pen line it hangs
 *  under (an answer under a paragraph). -1 otherwise. */
export function answerBefore(lines: readonly string[], i: number): number {
  const line = lines[i]!;
  if (i === 0 || penKindOf(line) || !isItem(line)) return -1;
  const prev = lines[i - 1]!;
  const kind = penKindOf(prev);
  if (kind !== "s" && kind !== "r") return -1;
  if (isPenParagraph(prev)) return i - 1;
  return isItem(prev) && indentWidth(prev) === indentWidth(line) ? i - 1 : -1;
}

/** The sealed answer a line is your take on: the one right beside it, or
 *  (an answer the earlier pen wrote) its parent. -1 otherwise. */
export function sealedAbove(lines: readonly string[], i: number): number {
  const line = lines[i]!;
  if (penKindOf(line) || !isItem(line)) return -1;
  const beside = answerBefore(lines, i);
  if (beside >= 0) return penKindOf(lines[beside]!) === "s" ? beside : -1;
  const parent = parentOf(lines, i);
  return parent >= 0 && penKindOf(lines[parent]!) === "s" ? parent : -1;
}

/** The empty line under an opened answer's take, where Combine waits: the
 *  answer and your take, or null. */
export function combineAt(
  lines: readonly string[],
  i: number,
): { answer: number; take: number } | null {
  const line = lines[i]!;
  if (i < 2 || !isItem(line) || penKindOf(line) || itemText(line)) return null;
  const take = i - 1;
  const takeLine = lines[take]!;
  if (!isItem(takeLine) || !itemText(takeLine) || indentWidth(takeLine) !== indentWidth(line)) {
    return null;
  }
  const answer = answerBefore(lines, take);
  return answer >= 0 && penKindOf(lines[answer]!) === "r" ? { answer, take } : null;
}

/** A sealed answer's line, opened: its id says `r` instead of `s`. */
export function unsealedLine(line: string): string {
  return line.replace(/\^ai-s-([a-z0-9]{4})(\s*)$/, "^ai-r-$1$2");
}

/* --------------------------------------------------------------- source */

export interface PenSource {
  /** What the writer took notes on. */
  kind: "video" | "book";
  /** "the video", "the book" — how prompts and the bar name it. */
  label: string;
  /** Paragraphs, each with where it is: `m:ss` or a page. */
  passages: Array<{ where: string; text: string }>;
}

const SOURCE_CHARS = 14_000;
const NOTE_CHARS = 8_000;

/** Transcript paragraphs up to `upTo` seconds, trimmed to fit: the ones
 *  nearest `focus` when given, else the latest seen. */
export function videoPassages(
  cues: ReadonlyArray<{ start: number; text: string }>,
  upTo: number,
  focus: number | null,
): PenSource["passages"] {
  const seen = cues.filter((c) => c.start <= upTo);
  const order = [...seen.keys()].sort((a, b) =>
    focus === null ? b - a : Math.abs(seen[a]!.start - focus) - Math.abs(seen[b]!.start - focus),
  );
  const kept = new Set<number>();
  let size = 0;
  for (const k of order) {
    size += seen[k]!.text.length + 8;
    if (size > SOURCE_CHARS && kept.size > 0) break;
    kept.add(k);
  }
  return seen
    .filter((_, k) => kept.has(k))
    .map((c) => ({ where: formatVideoTime(c.start), text: c.text }));
}

/** The second a line is about: its pin, or its parent's. */
export function pinnedSecond(lines: readonly string[], i: number): number | null {
  for (let j = i; j >= 0; j = parentOf(lines, j)) {
    const id = BLOCK_ID_AT_END_RE.exec(lines[j]!);
    const seconds = id ? parseVideoPinId(id[1]!) : null;
    if (seconds !== null) return seconds;
  }
  return null;
}

/** A video note's transcript toggle and the blank lines after it. */
const TRANSCRIPT_IN_NOTE = new RegExp(`${TRANSCRIPT_BLOCK.source}\\n*`, "i");

/** The note as the pen reads it: no transcript (it comes as the source), pins
 *  as their time, the pen's own lines marked. */
export function noteForPen(body: string): string {
  const text = body
    .replace(TRANSCRIPT_IN_NOTE, "")
    .split("\n")
    .map((line) => {
      const id = BLOCK_ID_AT_END_RE.exec(line);
      if (!id) return line;
      const seconds = parseVideoPinId(id[1]!);
      if (seconds !== null) return `${line.slice(0, id.index)} [at ${formatVideoTime(seconds)}]`;
      if (penIdKind(id[1]!))
        return `${line.slice(0, id.index).replace(/^(\s*[-*+] )/, "$1[pen] ")}`;
      return line.slice(0, id.index);
    })
    .join("\n");
  return text.length > NOTE_CHARS ? `${text.slice(0, NOTE_CHARS)}\n[…]` : text;
}

/* -------------------------------------------------------------- prompts */

/** The pen's standing instructions (`--append-system-prompt`). */
export const PEN_INSTRUCTIONS = [
  "You are the second pen in Pensée, a writer's notes app. You write one line in their notes when they ask.",
  "Each message asks for one thing and carries everything you may use: the note, the lines asked about, and sometimes the source the note is on or research papers.",
  "Reply with exactly what the message asks for and nothing else: no preamble, no explanation, no markdown, no list marker, no quotation marks around the whole reply.",
  "Write in the language the writer's note is written in. Plain words, short. Never praise, never moralise. You help the writer think; you never write their conclusion for them.",
].join("\n");

export type PenAsk =
  | { task: "answer"; already: string[]; question?: string }
  | { task: "judge"; question: string; take: string }
  | { task: "combine"; question: string; answer: string; take: string }
  | { task: "factQuery" }
  | { task: "factRetry" }
  | { task: "sides"; papers: Paper[] }
  | { task: "connectQuery" }
  | { task: "connectPick"; candidates: Array<{ note: string; text: string }> }
  | { task: "organize"; lines: readonly string[] };

export interface PenPromptInput {
  title: string;
  note: string;
  /** The lines asked about, in order. Empty for a quiz on everything so far. */
  lines: string[];
  source: PenSource | null;
  ask: PenAsk;
  /** What the writer typed in the pen's box to steer this, if anything. */
  direction?: string;
}

function list(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function sourceBlock(source: PenSource): string {
  return [
    `<source what="${source.label}">`,
    ...source.passages.map((p) => `[${p.where}] ${p.text}`),
    "</source>",
  ].join("\n");
}

function paperBlock(papers: readonly Paper[]): string {
  return papers
    .map((p, k) =>
      [
        `<paper n="${k + 1}">`,
        `title: ${p.title}`,
        `year: ${p.year ?? "?"}; cited by: ${p.citedBy}; venue: ${p.venue ?? "?"}`,
        `abstract: ${p.abstractText ?? "(none)"}`,
        "</paper>",
      ].join("\n"),
    )
    .join("\n");
}

/** What an echo is, said first in a word or two: it supports the line,
 *  contradicts it, is an example of it (your own experience included), a
 *  definition of its term, a summary of the same idea, an earlier answer to
 *  its question, or another angle on it. */
export const ECHO_LABELS = [
  "Supports",
  "Contradicts",
  "Example",
  "Definition",
  "Summary",
  "Answer",
  "Another angle",
] as const;
export type EchoLabel = (typeof ECHO_LABELS)[number];

function taskText(input: PenPromptInput): string {
  const { ask, source } = input;
  const label = source?.label ?? "the source";
  switch (ask.task) {
    case "answer":
      return [
        ask.question
          ? `The writer asks you: ${ask.question}\nThe target lines are what they were on when they asked. Answer in one or two short sentences, plainly.`
          : "The writer asks you: the target lines are their question (or a line they want explained). Answer it in one or two short sentences, plainly.",
        "Your answer stays hidden until the writer has written their own take, then the two are compared: give your real, best answer.",
        ask.already.length
          ? `Your answers already here (go further, don't repeat them):\n${list(ask.already)}`
          : "",
        source
          ? `When ${label} covers it, answer from it, and always end with " — " and the time or place the source gives for the passage you used, e.g. … — 12:34. Never leave the time out when the answer comes from ${label}. When it doesn't cover it, answer from what you know, without a time.`
          : "Answer from what you know. Say so plainly when you aren't sure.",
      ].join("\n");
    case "judge":
      return [
        `The writer asked: ${ask.question}`,
        `The writer's own take, written before they see your answer: ${ask.take}`,
        'Judge the take: is it a real attempt at the question? A wrong, short, unsure or half-formed guess is real. Random letters, a joke, or words unrelated to the question ("sad lion sits there", ".isoadjoj") are not: then your answer stays hidden.',
        'Reply with JSON only: {"real": true} or {"real": false}.',
      ].join("\n");
    case "combine":
      return [
        `The writer asked: ${ask.question}`,
        `Your answer: ${ask.answer}`,
        `The writer's own take: ${ask.take}`,
        "Combine the two into one tree the writer can think through point by point. It must be MECE at every level: the points side by side (at the top, or under one point) are the same kind of thing at the same level of detail, no two overlap, and together they cover what they sit under. A point that is not the same kind or level as the points beside it never stays beside them: it goes under the point it belongs to. Together the tree covers everything in the take and the answer.",
        "The writer's points: their exact words, every word of the take, each part once, in its order. Split the take wherever one idea ends and the next starts: one idea per point. You may only split it and drop joining words (then, and, so, but) and end punctuation. Never add, reword or reorder a word.",
        `Your points: only what your answer adds that the take doesn't say, each short (at most 12 words), your own words, joining words dropped. Never say again what the writer said, not even in other words ("slow down yourself" when they wrote "slow down myself"): their point stands and you write nothing for it. When yours adds a detail to theirs, write only the detail, under their point. When your answer adds nothing, give no points of yours.`,
        "Nest by meaning, not by who wrote it: a point that is a part, step, example, reason or result of another goes under it, the broader point on top, whoever wrote either. A writer's point may sit under one of yours. Points that are separate branches stay side by side. Two levels of nesting at most.",
        'Mark how: "the opposite" on a point of yours that contradicts the point it sits under or after. Never say which is right.',
        'Reply with JSON only: {"points": [{"by": "you" or "pen", "text": "…", "how": "the opposite" (only then), "under": [same shape, "under" two levels deep at most]}]}',
      ].join("\n");
    case "factQuery":
      return [
        "Write a search query for research papers that bear on the target lines: ones that would support or challenge a claim, or answer what the lines ask (how to do it, why, when).",
        "3 to 8 English words, the terms researchers would use. Reply with the query only.",
      ].join("\n");
    case "factRetry":
      return [
        "That search found nothing usable. Write a different, broader search query: 2 to 5 English words, the field's common terms.",
        "Reply with the query only.",
      ].join("\n");
    case "sides":
      return [
        "These research papers came back for the target lines, best first.",
        paperBlock(ask.papers),
        "Write two lines on what the papers say about the target lines, using only what the abstracts say. Never give a verdict.",
        "First work out what the target lines are, read with the lines they sit under: a claim to weigh, or something the writer wants to know (how to do it, why, when, what it is). Pick the two lines and their labels to fit that and what the papers offer.",
        'A claim is a line that says something is so ("naps help you remember", "rereading feels like learning"): set "claim": true. Its first line is the strongest support, its second the strongest challenge (or, when no paper challenges it, the limit of the evidence for it); they are labelled For and Against for you.',
        'Anything else (how to do something, why, when, what it is): set "claim": false and give each line a label that says what it gives, e.g. "How" and "Caveat" for how to do something, "Why" and "But", "Answer" and "Limit". Never "For" or "Against": the line takes no side.',
        "Each line: one sentence, from one paper. The second: when no paper gives it, the main limit of the evidence in the first (a small study, a different population, never measured directly, nothing on this exact use), with paper 0.",
        "Each label: one or two words, capitalised, no colon, in the note's language.",
        'Reply with JSON only: {"claim": true or false, "lines": [{"label": "…", "paper": N, "text": "…"}, {"label": "…", "paper": N, "text": "…"}]}. Use paper 0 for a line no paper speaks to. If no abstract bears on the lines at all, reply {}.',
      ].join("\n");
    case "connectQuery":
      return [
        "The writer wants to find what they wrote before, in their other notes, about the idea in the target lines. Only the target lines: the rest of the note is context, not what to search for.",
        "Give the words most likely to appear in those notes: 4 to 8 single words or two-word phrases, in the language of the note, with common variants (a plural, a synonym). No stop words.",
        'Reply with JSON only: an array of strings, e.g. ["dopamine", "reward", "motivation"].',
      ].join("\n");
    case "connectPick":
      return [
        "Lines the writer wrote in their other notes, found by a word search:",
        ask.candidates
          .map((c, k) => `<line n="${k + 1}" note="${c.note.replace(/"/g, "'")}">${c.text}</line>`)
          .join("\n"),
        "Pick 1 to 3 that meet the idea of the target lines: the same idea, the opposite of it, an earlier answer to the target's question, another angle on it, or the writer's own experience of it. Prefer different notes. Skip a line that only shares a word and is about something else.",
        `For each, label what it is for the target lines with exactly one of: ${ECHO_LABELS.map((r) => `"${r}"`).join(", ")}. Supports: it backs the target up. Contradicts: it says the opposite. Example: a case of it, the writer's own experience included. Definition: it defines the target's term. Summary: the same idea, said before. Answer: it answers the target's question. Another angle: a different view on it.`,
        "And write its point: what the writer found or thought there, as it bears on the target lines, in one short sentence of at most 20 words (two only if one can't carry it), addressed as you, in the note's language. Never copy the whole line: the link to the note keeps the original.",
        'Reply with JSON only: [{"n": N, "label": "…", "point": "…"}], best first. [] only when no line is about the same subject.',
      ].join("\n");
    case "organize": {
      const sentences = organizeSentences(ask.lines);
      return [
        "The writer's text to organize, sentence by sentence, numbered (line says which of their lines it is from):",
        `<text>\n${sentences.map((s, k) => `<s n="${k + 1}" line="${s.line + 1}">${s.text}</s>`).join("\n")}\n</text>`,
        "This task is the exception to writing one line: you write the whole outline, and the ideas in it are yours.",
        "Don't hand the writer's story back to them. Build understanding from it: what it shows, as ideas they can apply again. Their own words stay as they are, under the points they back: you never rewrite them.",
        "First split the text into topics: each separate subject is its own topic, one if it is all one subject. A topic's name: 1 to 4 words.",
        "Then grow each topic's tree from the writing itself. There is no fixed template: read how the writer's ideas lean on each other (a claim, a reason for it, a case of it, a step, a cause, a feeling, an image, an objection, a question it raises, what follows for next time) and let those relations make the branches and the levels.",
        "- The first point says what the topic comes to: one sentence, at most 30 words, a general claim that reaches past this one case, never a summary of what happened. Label it for what it is: Theory for a lesson from experience, Claim for an argument, Pattern, Question, Image…",
        "- A level exists only where the writing has one: a point gets points under it only when the text gives two or more distinct things that belong there; with one, say it in the point itself. Count the writer's own levels (the lines they indented, the sentences that explain or show another) and go as deep as they do, no deeper: flat writing makes a shallow tree, writing whose ideas nest makes a deeper one, 4 levels at most. Never add a branch the text doesn't support, no rules or questions only to fill the shape.",
        "- Points side by side are the same kind of thing at the same level of detail, none overlap, and together they cover what they sit under.",
        '- Every point: a "label" of 1 to 3 words naming what kind of line it is, picked to fit this writing (Reason, Example, Step, Trigger, Feeling, Objection, Rule, Open…), and a "text" of one short sentence in your words, at most 25 words. The text may be "" only when the label heads what sits under it ("Rules" over the rules).',
        '- "says": the numbers of the writer\'s sentences that sit directly under the point, as what backs it. Put each sentence under the most specific point it backs.',
        "Every sentence is in exactly one point's says. A line the writer indented under another goes under the same point as it, or a point beneath that one. Never claim what the text doesn't support; never drop a topic it raises.",
        "Write in the language of the text, plainly, as the writer would write it (I, my).",
        'Reply with JSON only: {"topics": [{"name": "…", "points": [{"label": "…", "text": "…", "says": [1, 2], "under": [same shape]}]}]}',
      ].join("\n");
    }
  }
}

export function penPrompt(input: PenPromptInput): string {
  const parts = [
    `<note title="${input.title.replace(/"/g, "'")}">\n${input.note}\n</note>`,
    input.lines.length ? `<target-lines>\n${input.lines.join("\n")}\n</target-lines>` : "",
    input.source && input.ask.task === "answer" ? sourceBlock(input.source) : "",
    input.direction && !(input.ask.task === "answer" && input.ask.question)
      ? `The writer's direction for this, follow it: ${input.direction}`
      : "",
    taskText(input),
  ];
  return parts.filter(Boolean).join("\n\n");
}

/* ------------------------------------------------------------- replies */

/** The one line a reply means, or null for NONE or nothing. Strips what a
 *  model adds anyway: a list marker, wrapping quotes, a block id. */
export function replyLine(reply: string, keepQuotes = false): string | null {
  const first = reply
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return null;
  let line = first
    .replace(/^([-*•]|\d+[.)])\s+/, "")
    .replace(BLOCK_ID_AT_END_RE, "")
    .trim();
  if (/^none\.?$/i.test(line)) return null;
  if (!keepQuotes && /^["“].*["”]$/.test(line)) line = line.slice(1, -1).trim();
  // "… — 1:10." reads as the time with a stray full stop.
  line = line.replace(/( — [^—.]{1,24})\.$/, "$1");
  return line || null;
}

function jsonIn(reply: string): unknown {
  const start = reply.search(/[[{]/);
  const end = Math.max(reply.lastIndexOf("]"), reply.lastIndexOf("}"));
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** A `judge` reply: whether the take was a real attempt. Null when the
 *  reply can't be read. */
export function judgeReply(reply: string): boolean | null {
  const value = jsonIn(reply) as { real?: unknown } | null;
  return value && typeof value.real === "boolean" ? value.real : null;
}

/* -------------------------------------------------------------- combine */

/** A point of the combined list: yours (in your words) or the pen's, with
 *  the points that are a part, step, example or reason of it under it. */
export interface CombinedPoint {
  by: "you" | "pen";
  text: string;
  /** A pen point that says the opposite of the one it sits under or after. */
  opposite: boolean;
  under: CombinedPoint[];
}

/** The combined tree: two levels of nesting at most. */
export type Combined = CombinedPoint[];

const MAX_NEST = 2;

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const endPunct = (text: string) =>
  text
    .trim()
    .replace(/[.,;!?。，；！？]+$/u, "")
    .trim();

/** Short points from a sentence or two, without a model: split at its
 *  punctuation, joining words and end punctuation dropped. */
export function splitPoints(text: string): string[] {
  return text
    .split(/(?<=[.,;!?。，；！？])\s*/u)
    .map((part) => endPunct(part.trim().replace(/^(then|and|so|but)\s+/i, "")))
    .filter(Boolean);
}

/** The words of a take that must survive the split: all but joining words. */
const takeWords = (text: string) =>
  (squash(text).match(/\p{L}+/gu) ?? []).filter((w) => !/^(then|and|so|but)$/.test(w));

/** Who a line speaks of: the pen says "you" for the writer's "I", so neither
 *  counts as a word of what it says. */
const PERSON_WORDS = new Set("i me my mine myself you your yours yourself".split(" "));

/** What a line says: its words but joining, function and person words, a
 *  plural's "s" dropped. */
const meaningWords = (text: string) =>
  takeWords(text)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w) && !PERSON_WORDS.has(w))
    .map((w) => w.replace(/(?<=\p{L}{3})s$/u, ""));

/** A `combine` reply, held to its word: your points must be your words, every
 *  one of them, each once (else your take is split at its punctuation and the
 *  pen's points follow it, unnested); the pen's must be there unless every
 *  one of them was yours already (else its answer is split the same way), and
 *  never your take said again (a pen point whose every word is in your take,
 *  "yourself" for your "myself" included, is dropped, never written as the
 *  pen's). */
export function combineReply(reply: string, take: string, answer: string): Combined {
  const value = jsonIn(reply) as { points?: unknown } | null;
  const read = (raw: unknown, depth: number): CombinedPoint[] => {
    const item = raw as { by?: unknown; text?: unknown; how?: unknown; under?: unknown } | null;
    const kids = Array.isArray(item?.under) ? item.under.flatMap((k) => read(k, depth + 1)) : [];
    const by = item?.by === "you" ? "you" : item?.by === "pen" ? "pen" : null;
    const text =
      typeof item?.text !== "string"
        ? null
        : by === "you"
          ? endPunct(item.text)
          : replyLine(item.text);
    // A point with no words: its points take its place.
    if (!by || !text) return kids;
    const opposite = by === "pen" && typeof item?.how === "string" && /opposite/i.test(item.how);
    // Past the deepest level, a point's points sit beside it.
    return depth < MAX_NEST
      ? [{ by, text, opposite, under: kids }]
      : [{ by, text, opposite, under: [] }, ...kids];
  };
  const parsed = Array.isArray(value?.points) ? value.points.flatMap((p) => read(p, 0)) : [];
  const whole = squash(take);
  const said = new Set(meaningWords(take));
  // A pen point that only says your take again goes (its points take its
  // place). When every pen point did, the model echoed your take instead of
  // its answer, so the answer's own points stand in for them.
  const repeats = (p: CombinedPoint) =>
    p.by === "pen" &&
    (whole.includes(squash(endPunct(p.text))) || meaningWords(p.text).every((w) => said.has(w)));
  const flat = (ps: readonly CombinedPoint[]): CombinedPoint[] =>
    ps.flatMap((p) => [p, ...flat(p.under)]);
  const echoed = flat(parsed).some(repeats);
  const prune = (p: CombinedPoint): CombinedPoint[] => {
    const under = p.under.flatMap(prune);
    return repeats(p) ? under : [{ ...p, under }];
  };
  const points = parsed.flatMap(prune);
  const point = (by: CombinedPoint["by"], text: string): CombinedPoint => ({
    by,
    text,
    opposite: false,
    under: [],
  });
  const answerPoints = () =>
    splitPoints(answer)
      .map((t) => point("pen", t))
      .filter((p) => !repeats(p));
  const all = flat(points);
  const yours = all.filter((p) => p.by === "you").map((p) => squash(p.text));
  const kept = new Set(takeWords(yours.join(" ")));
  const faithful =
    yours.length > 0 &&
    new Set(yours).size === yours.length &&
    yours.every((point) => whole.includes(point)) &&
    takeWords(take).every((w) => kept.has(w));
  const pens = all.filter((p) => p.by === "pen");
  if (faithful) return pens.length || !echoed ? points : [...points, ...answerPoints()];
  return [
    ...splitPoints(take).map((t) => point("you", t)),
    ...(pens.length ? pens.map((p) => point("pen", p.text)) : answerPoints()),
  ];
}

/** The combined tree as Markdown lines at `indent`, each level two spaces
 *  further in, then an empty line for yours. `id` names each pen line. */
export function combinedLines(combined: Combined, indent: string, id: () => string): string[] {
  const lines = (p: CombinedPoint, at: string): string[] => [
    p.by === "pen"
      ? `${at}- ${p.text}${p.opposite ? " — the opposite" : ""} ^${id()}`
      : `${at}- ${p.text}`,
    ...p.under.flatMap((k) => lines(k, `${at}  `)),
  ];
  const out = combined.flatMap((p) => lines(p, indent));
  out.push(`${indent}- `);
  return out;
}

/** A take with no word in it at all is nobody's guess: no need to ask. */
export function isNonsenseTake(text: string): boolean {
  return !/\p{L}{2,}/u.test(text);
}

export interface Side {
  /** What the line gives, fit to what was asked: `For`, `How`, `Caveat`… */
  label: string;
  text: string;
  paper: Paper | null;
}

/** A side's label: a word or two, never a sentence or a colon. */
const SIDE_LABEL_RE = /^[^\s:：][^:：\n]{0,23}$/u;

/** A check's label at the start of its line (`For:`, `How:`), drawn bold. */
export const SIDE_LABEL_AT_START_RE = /^[^\s:：[][^:：\n[]{0,23}[:：]/u;

/** The two lines from a `sides` reply; null when no abstract bore on the
 *  lines, or the reply named a paper that isn't there. A claim's lines are
 *  always For and Against, whatever the reply called them. */
export function sidesReply(reply: string, papers: readonly Paper[]): [Side, Side] | null {
  const value = jsonIn(reply) as { claim?: unknown; lines?: unknown } | null;
  if (!value || typeof value !== "object" || !Array.isArray(value.lines)) return null;
  const claim = value.claim === true;
  const side = (raw: unknown, claimLabel: string): Side | null => {
    const v = raw as { label?: unknown; paper?: unknown; text?: unknown } | null;
    if (!v || typeof v.text !== "string") return null;
    const text = replyLine(v.text);
    const label = claim
      ? claimLabel
      : typeof v.label === "string"
        ? v.label.trim().replace(/[:：]$/, "")
        : "";
    if (!text || !SIDE_LABEL_RE.test(label)) return null;
    const n = typeof v.paper === "number" ? v.paper : 0;
    if (n === 0) return { label, text, paper: null };
    const paper = papers[n - 1];
    return paper ? { label, text, paper } : null;
  };
  if (value.lines.length !== 2) return null;
  const first = side(value.lines[0], "For");
  const second = side(value.lines[1], "Against");
  // Two lines, and at least one of them a paper: otherwise it's an opinion.
  return first && second && (first.paper || second.paper) ? [first, second] : null;
}

/** A side as the pen writes it: its label, the sentence, its paper's pill. */
export function sideLine(side: Side): string {
  return `${side.label}: ${side.text}${side.paper ? ` ${citationMarkdown(side.paper)}` : ""}`;
}

/** The search words from a `connectQuery` reply, at most 8. */
export function connectTerms(reply: string): string[] {
  const value = jsonIn(reply);
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v.length >= 3),
    ),
  ].slice(0, 8);
}

const STOP_WORDS = new Set(
  "about above after again also because been before being below between both could does doing down during each from further have having here into itself just more most much need only other over really same should some such than that their them then there these they this those through under until very what when where which while will with would your yours".split(
    " ",
  ),
);

/** The target lines' own content words, for Connect's search alongside the
 *  pen's: words of four letters or more that aren't function words. */
export function contentWords(lines: readonly string[]): string[] {
  const words = lines
    .join(" ")
    .toLowerCase()
    .match(/\p{L}{4,}/gu);
  return [...new Set((words ?? []).filter((w) => !STOP_WORDS.has(w)))];
}

export interface Echo {
  /** The candidate it came from, 0-based. */
  index: number;
  label: EchoLabel;
  /** The pen's short point; null when the reply gave none. */
  point: string | null;
}

/** An echo's point is short: past this many words it's cut at a word. */
const ECHO_POINT_WORDS = 32;

/** The echoes a `connectPick` reply chose, at most 3, one per candidate. */
export function echoesReply(reply: string, count: number): Echo[] {
  const value = jsonIn(reply);
  if (!Array.isArray(value)) return [];
  const out: Echo[] = [];
  for (const item of value as Array<{ n?: unknown; label?: unknown; point?: unknown }>) {
    const index = typeof item?.n === "number" ? item.n - 1 : -1;
    const asked = typeof item?.label === "string" ? item.label.trim().toLowerCase() : "";
    const label = ECHO_LABELS.find((l) => l.toLowerCase() === asked);
    if (index < 0 || index >= count || !label || out.some((o) => o.index === index)) continue;
    let point = typeof item.point === "string" ? replyLine(item.point) : null;
    const words = point?.split(/\s+/) ?? [];
    if (point && words.length > ECHO_POINT_WORDS) {
      point = `${words
        .slice(0, ECHO_POINT_WORDS)
        .join(" ")
        .replace(/[\s,;:.]+$/, "")}…`;
    }
    out.push({ index, label, point });
    if (out.length === 3) break;
  }
  return out;
}

const ECHO_QUOTE_MAX = 200;

/** One of your earlier lines, clean: no marker, task box, heading hashes,
 *  HTML or block id, cut at a word near `max` characters. */
export function echoQuote(line: string, max = ECHO_QUOTE_MAX): string {
  let text = line
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*(#{1,6}\s+|>\s*)/, "")
    .replace(ITEM_RE, "")
    .replace(BLOCK_ID_AT_END_RE, "")
    .replace(/^["“]|["”]$/g, "")
    .trim();
  if (text.length > max) {
    const cut = text.lastIndexOf(" ", max);
    text = `${text.slice(0, cut > max * 0.4 ? cut : max).replace(/[\s,;:.]+$/, "")}…`;
  }
  return text;
}

/** An echo as the pen writes it: what it is, its short point (or, without
 *  one, a short quote), and its note as a link that keeps the original. */
export function echoLine(echo: Echo, line: string, note: string): string {
  const point = echo.point ?? `“${echoQuote(line, 90)}”`;
  return `${echo.label}: ${point} — [[${note}]]`;
}

/** The notes the echoes under a line already link to. */
export function echoedNotes(echoLines: readonly string[]): Set<string> {
  return new Set(
    echoLines.flatMap((line) => [...line.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1]!.trim())),
  );
}

/** `Smith et al. 2024`, `Murre & Dros 2015`, or the venue when no author. */
export function citationLabel(paper: Paper): string {
  const surname = (name: string) => name.trim().split(/\s+/).pop() ?? name;
  const [a, b] = paper.authors;
  const who = !a
    ? (paper.venue ?? "Paper")
    : paper.authors.length === 1
      ? surname(a)
      : paper.authors.length === 2 && b
        ? `${surname(a)} & ${surname(b)}`
        : `${surname(a)} et al.`;
  return paper.year ? `${who} ${paper.year}` : who;
}

const TITLE_SEP = " | ";

/** The citation after a fact: a Markdown link to the paper, its details in
 *  the link title so the note keeps them (`citationOf` reads them back). */
export function citationMarkdown(paper: Paper): string {
  const clean = (text: string) =>
    text
      .replace(/["\\]/g, "'")
      .replace(/\s*\|\s*/g, " / ")
      .trim();
  const details = [
    clean(paper.title),
    clean(paper.authors.join(", ")),
    clean([paper.venue, paper.year].filter(Boolean).join(" ")),
    `cited by ${paper.citedBy}`,
  ];
  return `[${clean(citationLabel(paper)).replace(/[[\]]/g, "")}](${paper.url} "${details.join(TITLE_SEP)}")`;
}

const CITATION_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?: "([^"]*)")?\)/g;

export interface Citation {
  from: number;
  to: number;
  label: string;
  url: string;
  title: string | null;
  authors: string | null;
  venue: string | null;
  citedBy: string | null;
}

/** The citations in a line of text, with their offsets. */
export function citationsIn(line: string): Citation[] {
  return [...line.matchAll(CITATION_RE)].map((match) => {
    const [title, authors, venue, citedBy] = (match[3] ?? "").split(TITLE_SEP);
    return {
      from: match.index,
      to: match.index + match[0].length,
      label: match[1]!,
      url: match[2]!,
      title: title || null,
      authors: authors || null,
      venue: venue || null,
      citedBy: citedBy || null,
    };
  });
}

/** Where the faint source part of a check or fact starts: its last ` — `. */
export function sourcePartStart(text: string): number | null {
  const at = text.lastIndexOf(" — ");
  return at > 0 ? at : null;
}

/* ------------------------------------------------------------- organize */

/** A topic of an organized text: its name and its tree of points. */
export interface OrganizedTopic {
  name: string;
  points: OrganizedPoint[];
}

/** A point of a topic's tree, grown from how your writing hangs together:
 *  what kind of line it is (`label`, in bold), the pen's sentence (empty when
 *  the label only heads what sits under it), your words that back it, and
 *  the points under it. */
export interface OrganizedPoint {
  label: string;
  text: string;
  /** Your words, in order. */
  evidence: EvidencePiece[];
  under: OrganizedPoint[];
}

/** Your writing under a point: a whole line of yours as you wrote it
 *  (`sentences` null), or some of its sentences when the rest went under
 *  another point (their indexes in `organizeSentences`). */
export interface EvidencePiece {
  line: number;
  sentences: number[] | null;
}

/** The sentences Organize numbers for the pen: each line's, in order. */
export function organizeSentences(lines: readonly string[]): { line: number; text: string }[] {
  return lines.flatMap((line, k) => {
    const text = bodyOf(line);
    const said = sentencesOf(text);
    return (said.length ? said : [text]).map((s) => ({ line: k, text: s }));
  });
}

/** A label: one to three words, no colon. */
const KEY_RE = /^\p{L}[\p{L}'’-]*(?: [\p{L}\p{N}'’-]+){0,2}$/u;
/** What a reply may say, a little past what the prompt asks. */
const NAME_MAX_WORDS = 6;
const POINT_MAX_WORDS = 45;
/** How deep a topic's points go, whatever the reply nests. */
const MAX_LEVELS = 4;

/** A text's sentences: split after . ! ? (a link's dots have no space after). */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** A line's words: no list marker, task box, heading marks or block id. */
const bodyOf = (line: string) => itemText(line).replace(/^#{1,6}\s+/, "");
const boxOf = (line: string) => ITEM_RE.exec(line)?.[4] ?? "";
const blockIdOf = (line: string) => BLOCK_ID_AT_END_RE.exec(line)?.[1] ?? null;

/** An `organize` reply, held to its word: topics with a name and a tree of
 *  labelled points, every sentence of yours under exactly one point. A point
 *  without a label hands its sentences to the point above and its points move
 *  up; points past the fourth level hand theirs to the one at it. A sentence
 *  no point claimed goes with the one before it (the first, with the next one
 *  claimed), and a line you indented under another goes under the same point
 *  or one beneath it. A topic with no point of the pen's own goes, and so
 *  does one left with none of your sentences. A line whose sentences all went
 *  under one point stays whole, as you wrote it. Null when nothing usable
 *  came back. */
export function organizeReply(reply: string, lines: readonly string[]): OrganizedTopic[] | null {
  const value = jsonIn(reply) as { topics?: unknown } | null;
  if (!Array.isArray(value?.topics)) return null;
  const sentences = organizeSentences(lines);
  const owner: number[] = sentences.map(() => -1);
  const textOf = (raw: unknown, max: number): string => {
    if (typeof raw !== "string") return "";
    const text = raw
      .replace(/\s+/g, " ")
      .replace(/^\*{0,2}[^*:：]{1,30}[:：]\*{2}\s*/u, "")
      .trim();
    return text && wordCount(text) <= max ? text : "";
  };
  const asObject = (raw: unknown) =>
    (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  const listOf = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);
  const nodes: { label: string; text: string; under: number[]; parent: number }[] = [];
  const claim = (raw: unknown, at: number) => {
    const k = typeof raw === "number" && Number.isInteger(raw) ? raw - 1 : -1;
    if (k >= 0 && k < owner.length && owner[k] === -1) owner[k] = at;
  };
  // Too deep: every sentence under it goes to the point at the last level.
  const claimAll = (raw: unknown, at: number) => {
    for (const item of listOf(raw).map(asObject)) {
      for (const n of listOf(item?.says)) claim(n, at);
      claimAll(item?.under, at);
    }
  };
  const grow = (raw: unknown, parent: number, level: number, into: number[]) => {
    for (const item of listOf(raw).map(asObject)) {
      const label =
        typeof item?.label === "string" ? item.label.replace(/[*:：]/gu, "").trim() : "";
      if (!KEY_RE.test(label)) {
        // No label: its words go to the point above, its points move up.
        if (parent >= 0) for (const n of listOf(item?.says)) claim(n, parent);
        grow(item?.under, parent, level, into);
        continue;
      }
      const at = nodes.length;
      nodes.push({ label, text: textOf(item?.text, POINT_MAX_WORDS), under: [], parent });
      into.push(at);
      for (const n of listOf(item?.says)) claim(n, at);
      if (level < MAX_LEVELS) grow(item?.under, at, level + 1, nodes[at]!.under);
      else claimAll(item?.under, at);
    }
  };
  const found: { name: string; points: number[] }[] = [];
  for (const item of value.topics.map(asObject)) {
    const name = textOf(item?.name ?? item?.topic, NAME_MAX_WORDS)
      .replace(/[#*:：]/gu, "")
      .trim();
    if (!name) continue;
    const start = nodes.length;
    const points: number[] = [];
    grow(item?.points, -1, 1, points);
    // Only your words back, no point of the pen's: not a topic.
    if (!nodes.slice(start).some((n) => n.text)) {
      owner.forEach((o, k) => {
        if (o >= start) owner[k] = -1;
      });
      nodes.length = start;
      continue;
    }
    found.push({ name, points });
  }
  const first = owner.find((o) => o >= 0);
  if (first === undefined) return null;
  let last = first;
  for (let k = 0; k < owner.length; k++) {
    if (owner[k] === -1) owner[k] = last;
    last = owner[k]!;
  }
  // A line you indented under another goes under its point or one beneath:
  // the nesting you wrote never splits across branches.
  const within = (at: number, point: number) => {
    for (let x = at; x >= 0; x = nodes[x]!.parent) if (x === point) return true;
    return false;
  };
  const stack: { width: number; line: number }[] = [];
  lines.forEach((line, k) => {
    const width = indentWidth(line);
    while (stack.length && stack[stack.length - 1]!.width >= width) stack.pop();
    const parent = stack[stack.length - 1]?.line;
    if (parent !== undefined) {
      let at = sentences.length - 1;
      while (sentences[at]!.line !== parent) at--;
      const point = owner[at]!;
      sentences.forEach((s, j) => {
        if (s.line === k && !within(owner[j]!, point)) owner[j] = point;
      });
    }
    stack.push({ width, line: k });
  });
  const evidence: EvidencePiece[][] = nodes.map(() => []);
  for (let line = 0; line < lines.length; line++) {
    const mine = sentences.flatMap((s, k) => (s.line === line ? [k] : []));
    if (mine.every((k) => owner[k] === owner[mine[0]!])) {
      evidence[owner[mine[0]!]!]!.push({ line, sentences: null });
      continue;
    }
    // Split across points: each run of sentences goes to its own.
    for (const k of mine) {
      const pieces = evidence[owner[k]!]!;
      const run = pieces[pieces.length - 1];
      if (run?.line === line && run.sentences?.[run.sentences.length - 1] === k - 1) {
        run.sentences.push(k);
      } else {
        pieces.push({ line, sentences: [k] });
      }
    }
  }
  // A point with nothing to say and nothing under it goes.
  const build = (at: number): OrganizedPoint[] => {
    const node = nodes[at]!;
    const under = node.under.flatMap(build);
    return node.text || evidence[at]!.length || under.length
      ? [{ label: node.label, text: node.text, evidence: evidence[at]!, under }]
      : [];
  };
  const backed = (p: OrganizedPoint): boolean => p.evidence.length > 0 || p.under.some(backed);
  return found.flatMap((t) => {
    const points = t.points.flatMap(build);
    return points.some(backed) ? [{ name: t.name, points }] : [];
  });
}

/** Organized topics as Markdown lines. With `heading` (`##`…) each topic is a
 *  heading, its points a list under it; without, a bold item at `indent` with
 *  its points a level in. Every point is a line of the pen's (an id from
 *  `id`, its ink) led by its label in bold, the points under it a level in;
 *  your words sit right under the point they back, keeping their task box and
 *  block id, and the nesting you wrote among them, never more than a level
 *  deeper than the line before. */
export function organizedLines(
  topics: readonly OrganizedTopic[],
  lines: readonly string[],
  indent: string,
  heading: string | null,
  id: () => string,
): string[] {
  const sentences = organizeSentences(lines);
  // How deep each line of yours sits among the others.
  const levels: number[] = [];
  const stack: number[] = [];
  for (const line of lines) {
    const width = indentWidth(line);
    while (stack.length && stack[stack.length - 1]! >= width) stack.pop();
    levels.push(stack.length);
    stack.push(width);
  }
  const pen = (at: string, text: string) => `${at}- ${text} ^${id()}`;
  const yours = (piece: EvidencePiece, at: string): string => {
    const line = lines[piece.line]!;
    if (!piece.sentences) {
      const body = line.replace(/^[ \t]+/, "");
      return `${at}${ITEM_RE.test(line) ? body : `- ${body.replace(/^#{1,6}\s+/, "")}`}`;
    }
    const text = piece.sentences.map((k) => sentences[k]!.text).join(" ");
    // The line's box and block id go with its first sentence.
    const opens = sentences[piece.sentences[0]! - 1]?.line !== piece.line;
    const block = opens ? blockIdOf(line) : null;
    return `${at}- ${opens ? boxOf(line) : ""}${text}${block ? ` ^${block}` : ""}`;
  };
  const point = (p: OrganizedPoint, at: string): string[] => {
    const under = `${at}  `;
    let depth = -1;
    return [
      pen(at, p.text ? `**${p.label}:** ${p.text}` : `**${p.label}:**`),
      ...p.evidence.map((piece) => {
        depth = Math.min(levels[piece.line]!, depth + 1);
        return yours(piece, under + "  ".repeat(depth));
      }),
      ...p.under.flatMap((q) => point(q, under)),
    ];
  };
  return topics.flatMap((topic, n) => {
    const head = heading
      ? [...(n ? [""] : []), `${heading} ${topic.name}`]
      : [pen(indent, `**${topic.name}**`)];
    const at = heading ? indent : `${indent}  `;
    return [...head, ...topic.points.flatMap((p) => point(p, at))];
  });
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
