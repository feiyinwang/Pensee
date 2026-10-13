import { BLOCK_ID_AT_END_RE } from "./block-refs";
import { formatVideoTime, parseVideoPinId } from "./video-pins";
import type { Paper } from "./tauri";

// The second pen (SPECs/second-pen-spec.md): an AI that writes one line at a
// time under the line you're on. Pure text: its ids, where its lines go, the
// answer flow read back from the document (no hidden session), the prompts
// and the reply clean-up. The editor wiring is
// `components/editor-area/second-pen.ts`; the Claude call is
// `second-pen-agent.ts`.

/* ------------------------------------------------------------------ ids */

/** What a pen line is: an answer still sealed (`s`) or open (`r`), its
 *  comparison with your take (`v`), the evidence for (`p`) and against (`n`)
 *  a claim, or an echo of an earlier note (`e`). The earlier pen's lines (a
 *  quiz question `q`, a question `a`, a hint `h`, a check `c`, a fact `f`, a
 *  mix `m`) keep their ink. */
export type PenKind = "s" | "r" | "v" | "p" | "n" | "e" | "q" | "a" | "h" | "c" | "f" | "m";

const PEN_ID_RE = /^ai-([srvpneqahcfm])-[a-z0-9]{4}$/;

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
    for (const child of childrenOf(lines, anchor)) {
      if (!penKindOf(lines[child]!)) break;
      after = subtreeEnd(lines, child);
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

/** The sealed answer a line is your take on: its parent, when that is a
 *  sealed answer (`s`) and the line is yours. -1 otherwise. */
export function sealedAbove(lines: readonly string[], i: number): number {
  const line = lines[i]!;
  if (penKindOf(line) || !isItem(line)) return -1;
  const parent = parentOf(lines, i);
  return parent >= 0 && penKindOf(lines[parent]!) === "s" ? parent : -1;
}

/** A sealed answer's line, opened: its id says `r` instead of `s`. */
export function unsealedLine(line: string): string {
  return line.replace(/\^ai-s-([a-z0-9]{4})(\s*)$/, "^ai-r-$1$2");
}

/** The pen's lines of `kind` beside `i` under the same line that nobody
 *  answered: the echoes keeping `i` removes. Indexes, last first so removing
 *  them in order works. */
export function unansweredSiblings(lines: readonly string[], i: number, kind: PenKind): number[] {
  let siblings: number[];
  if (isPenParagraph(lines[i]!)) {
    // Plain pen lines under a paragraph: the run around `i`, a blank apart.
    let first = i;
    while (first >= 2 && !lines[first - 1]!.trim() && isPenParagraph(lines[first - 2]!)) first -= 2;
    siblings = [first, ...penParagraphsAfter(lines, subtreeEnd(lines, first))];
  } else {
    const parent = parentOf(lines, i);
    siblings = parent >= 0 ? childrenOf(lines, parent) : [];
  }
  return siblings
    .filter((j) => j !== i && penKindOf(lines[j]!) === kind && subtreeEnd(lines, j) === j)
    .reverse();
}

/** A question, not a claim: Check has nothing to weigh. */
export function isQuestion(text: string): boolean {
  return /[?？]\s*$/.test(text);
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

/** The note as the pen reads it: no transcript (it comes as the source), pins
 *  as their time, the pen's own lines marked. */
export function noteForPen(body: string): string {
  const text = body
    .replace(/<details>\s*<summary>\s*Transcript\s*<\/summary>[\s\S]*?<\/details>\n*/i, "")
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
  | { task: "compare"; question: string; answer: string; take: string }
  | { task: "factQuery" }
  | { task: "factRetry" }
  | { task: "sides"; papers: Paper[] }
  | { task: "connectQuery" }
  | { task: "connectPick"; candidates: Array<{ note: string; text: string }> }
  | { task: "shorten" }
  | { task: "organize"; block: string };

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
    case "compare":
      return [
        `The writer asked: ${ask.question}`,
        `Your answer: ${ask.answer}`,
        `The writer's own take, written before they saw yours: ${ask.take}`,
        'First judge the take: is it a real attempt at the question? A wrong, short, unsure or half-formed guess is real. Random letters, a joke, or words unrelated to the question ("sad lion sits there", ".isoadjoj") are not: then your answer stays hidden.',
        "If it is real, compare it with your answer in at most two short sentences, 40 words in all: what theirs already has, the one thing it leaves out or sees differently, ending with one question that makes them weigh the difference for themselves. Address them as you. Never praise, never grade.",
        'Reply with JSON only: {"real": true, "compare": "…"} or {"real": false}.',
      ].join("\n");
    case "factQuery":
      return [
        "Write a search query for research papers that would support or challenge the target lines.",
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
        "Lay out the evidence on both sides of the target lines, using only what the abstracts say. Never give a verdict.",
        "for: the strongest support for the lines, one sentence, from one paper.",
        "against: the strongest challenge to them, one sentence, from one paper; when no paper challenges them, the main limit of the evidence for them (a small study, a different population, never measured directly), with paper 0.",
        'Reply with JSON only: {"for": {"paper": N, "text": "…"}, "against": {"paper": N, "text": "…"}}. Use paper 0 for a side no paper speaks to. If no abstract bears on the lines at all, reply {}.',
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
    case "organize":
      return [
        "Reorganize the writer's lines below into a clearer structure: group related lines, put them in order, and nest each detail under the point it belongs to.",
        "Use their own words. Keep their phrases exactly as they wrote them; you may only reorder, regroup, indent, merge exact repeats, and add a few short group labels where a group needs a name. Never add an idea or drop one.",
        "A line may end with an id like ^yt-540 or ^ai-r-ab12: keep it at the end of the line whose words it ends.",
        "Reply with the Markdown lines only (bullets, nested bullets), no code fence, nothing else.",
        `<lines>\n${ask.block}\n</lines>`,
      ].join("\n");
    case "shorten":
      return [
        "Shorten each target line by cutting words only: filler, hedges, repetition. Never add, reorder or rewrite a word. Keep every idea and the meaning: cut words that add nothing, never a whole thought. Never cut an id (^…), a [[link]] or a [citation](…).",
        'Reply with JSON only: an array with one array per target line, in order, of the exact substrings to delete. Example for two lines: [["I think ", " basically"], []]. An empty array where every word is pulling its weight.',
      ].join("\n");
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

/** A `compare` reply: whether the take was a real attempt, and if so the
 *  comparison. Null when the reply can't be read. */
export function compareReply(
  reply: string,
): { real: false } | { real: true; text: string | null } | null {
  const value = jsonIn(reply) as { real?: unknown; compare?: unknown } | null;
  if (!value || typeof value.real !== "boolean") return null;
  if (!value.real) return { real: false };
  return {
    real: true,
    text: typeof value.compare === "string" ? replyLine(value.compare, true) : null,
  };
}

/** A take with no word in it at all is nobody's guess: no need to ask. */
export function isNonsenseTake(text: string): boolean {
  return !/\p{L}{2,}/u.test(text);
}

export interface Side {
  text: string;
  paper: Paper | null;
}

/** The two sides from a `sides` reply; null when no abstract bore on the
 *  lines, or the reply named a paper that isn't there. */
export function sidesReply(
  reply: string,
  papers: readonly Paper[],
): { pro: Side; con: Side } | null {
  const value = jsonIn(reply) as Record<string, unknown> | null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const side = (raw: unknown): Side | null => {
    const v = raw as { paper?: unknown; text?: unknown } | null;
    if (!v || typeof v.text !== "string") return null;
    const text = replyLine(v.text);
    if (!text) return null;
    const n = typeof v.paper === "number" ? v.paper : 0;
    if (n === 0) return { text, paper: null };
    const paper = papers[n - 1];
    return paper ? { text, paper } : null;
  };
  const pro = side(value.for);
  const con = side(value.against);
  // Two sides, and at least one of them a paper: otherwise it's an opinion.
  return pro && con && (pro.paper || con.paper) ? { pro, con } : null;
}

/** A side as the pen writes it: its label, the sentence, its paper's pill. */
export function sideLine(label: "For" | "Against", side: Side): string {
  return `${label}: ${side.text}${side.paper ? ` ${citationMarkdown(side.paper)}` : ""}`;
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

/** Where a Check side's or an echo's label ends (`For:`, `Supports:`), as an
 *  offset into the line's words; null when it has none. */
export function penLabelEnd(words: string): number | null {
  const match =
    /^(For|Against|Supports|Contradicts|Example|Definition|Summary|Answer|Another angle):\s/.exec(
      words,
    );
  return match ? match[0].length - 1 : null;
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

/* ------------------------------------------------------------- shorten */

export interface Cut {
  from: number;
  to: number;
}

/** The cuts a `shorten` reply proposes for each line, as offsets into that
 *  line's words. Substrings that aren't there are dropped; overlaps too. */
/** What Shorten never cuts: block ids (`^ai-e-ab12`), `[[links]]` and
 *  Markdown links (a paper's citation). Offsets into `text`. */
export function uncuttable(text: string): Cut[] {
  return [...text.matchAll(/(^|\s)\^[A-Za-z0-9-]+|\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)/g)].map(
    (m) => {
      const lead = m[1]?.length ?? 0;
      return { from: m.index + lead, to: m.index + m[0].length };
    },
  );
}

export function cutsFromReply(reply: string, texts: readonly string[]): Cut[][] | null {
  const value = jsonIn(reply);
  if (!Array.isArray(value)) return null;
  return texts.map((text, k) => {
    const kept = uncuttable(text);
    const wanted = Array.isArray(value[k]) ? (value[k] as unknown[]) : [];
    const cuts: Cut[] = [];
    let from = 0;
    for (const item of wanted) {
      if (typeof item !== "string" || !item.trim()) continue;
      let at = text.indexOf(item, from);
      if (at < 0) at = text.indexOf(item);
      if (at < 0) continue;
      const cut = { from: at, to: at + item.length };
      const overlaps = (c: Cut) => cut.from < c.to && cut.to > c.from;
      if (cuts.some(overlaps) || kept.some(overlaps)) continue;
      cuts.push(cut);
      from = cut.to;
    }
    return cuts.sort((a, b) => a.from - b.from);
  });
}

/** The outline an `organize` reply proposes: its Markdown, without a fence
 *  or blank lines at its ends. Null when there's nothing. */
export function organizedReply(reply: string): string | null {
  const text = reply
    .replace(/^\s*```[a-z]*\n/i, "")
    .replace(/\n```\s*$/, "")
    .replace(/^\n+|\s+$/g, "");
  return text.trim() ? text : null;
}

/** `text` without `cuts`, its spacing tidied where words left. */
export function applyCuts(text: string, cuts: readonly Cut[]): string {
  let out = text;
  for (const cut of [...cuts].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, cut.from) + out.slice(cut.to);
  }
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/^[ \t]+/, "")
    .replace(/,([.;:!?])/g, "$1");
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
