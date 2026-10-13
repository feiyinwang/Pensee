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

/** What a pen line is: a quiz question (`q`), a question about your thinking
 *  (`a`), a hint (`h`), a check against the source (`c`), a fact (`f`), a
 *  mix (`m`), or its answer to your question (`r`). */
export type PenKind = "q" | "a" | "h" | "c" | "f" | "m" | "r";

const PEN_ID_RE = /^ai-([qahcfmr])-[a-z0-9]{4}$/;

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

/** The pen line a line belongs to: itself, or the nearest pen question it
 *  hangs under (your answer, a hint, a check). */
export function questionAbove(lines: readonly string[], i: number): number | null {
  for (let j = i; j >= 0; j = parentOf(lines, j)) {
    const kind = penKindOf(lines[j]!);
    if (kind === "q" || kind === "a") return j;
  }
  return null;
}

/* --------------------------------------------------------- answer flow */

/** What Enter on your answer under a quiz question does, read from the
 *  document: `check` your answer, give a `hint` (an empty answer, no hint
 *  yet), or nothing once the question has its check. The hint and the check
 *  hang under the answer that asked for them. */
export type AnswerStep = { question: number; step: "check" | "hint" } | null;

export function answerStep(lines: readonly string[], i: number): AnswerStep {
  const line = lines[i]!;
  if (penKindOf(line) || !isItem(line)) return null;
  const q = parentOf(lines, i);
  if (q < 0 || penKindOf(lines[q]!) !== "q") return null;
  const kinds = lines.slice(q + 1, subtreeEnd(lines, q) + 1).map(penKindOf);
  if (kinds.includes("c")) return null;
  return { question: q, step: !itemText(line) && !kinds.includes("h") ? "hint" : "check" };
}

/** Mixes beside `i` under the same line that nobody answered: the ones
 *  keeping `i` removes. Indexes, last first so removing them in order works. */
export function unansweredSiblingMixes(lines: readonly string[], i: number): number[] {
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
    .filter((j) => j !== i && penKindOf(lines[j]!) === "m" && subtreeEnd(lines, j) === j)
    .reverse();
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
  "Write in the language the writer's note is written in. Plain words, short. Never praise, never moralise, never answer a question you ask yourself; answer the writer's only when the message asks you to.",
].join("\n");

export type PenAsk =
  | { task: "ask"; already: string[] }
  | { task: "quiz"; already: string[]; newTopic: boolean; focus: string | null }
  | { task: "hint"; question: string; answers: string[] }
  | { task: "check"; question: string; answers: string[] }
  | { task: "mix"; already: string[] }
  | { task: "answer"; already: string[]; question?: string }
  | { task: "factQuery" }
  | { task: "factRetry" }
  | { task: "factWrite"; papers: Paper[]; already: string[] }
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

function taskText(input: PenPromptInput): string {
  const { ask, source } = input;
  const label = source?.label ?? "the source";
  switch (ask.task) {
    case "ask":
      return [
        "Ask the writer one question about the target lines that makes them think harder: what they mean by it, what someone who disagrees would say first, what is missing, or what follows from it.",
        "Never answer it and never give your opinion. One sentence.",
        ask.already.length
          ? `Questions already asked here (don't repeat or rephrase them):\n${list(ask.already)}`
          : "",
      ].join("\n");
    case "quiz":
      return [
        `Quiz the writer for active recall on ${label}. Only the part of the source given counts as seen.`,
        ask.focus
          ? `The target line is about the part at ${ask.focus}; ask about that part.`
          : input.lines.length
            ? "Ask about what the target lines are about."
            : "Ask about anything in what the writer has seen so far.",
        ask.newTopic
          ? "Ask a recall question on an idea of the source that none of the questions already asked covers."
          : "If the questions already asked cover an idea, ask a follow-up on that idea instead: why it holds, how it works, an example from the writer's own life, or how it links to another idea in their note. Otherwise ask a recall question on the next idea.",
        "The first question on an idea is always a recall question: what the source said, answerable from the words of the source given, without giving the answer away. Why, how and example questions only follow a recall question already asked on that idea. You may quote the writer's own note back to them. One sentence.",
        "If there is nothing left to ask, or the source given is empty, reply NONE. Never write anything but the question itself.",
        ask.already.length ? `Questions already asked:\n${list(ask.already)}` : "",
      ].join("\n");
    case "hint":
      return [
        `The writer couldn't answer this question: ${ask.question}`,
        "Give one hint that helps them find the answer themselves. It must not contain the answer or the source's words for it: point to where it is, what kind of answer it is, or a question that leads there. One short sentence.",
        "Good, for “Which group remembered more after a week?”: Think about which group had to pull the material out of memory. Bad: The recall group remembered more.",
      ].join("\n");
    case "check":
      return [
        `Question: ${ask.question}`,
        `The writer answered:\n${list(ask.answers.length ? ask.answers : ["(nothing)"])}`,
        `Quote, word for word, the shortest passage of ${label} that answers the question, in curly quotes, then " — " and the time or place the source gives for it.`,
        "For example: “Sleep is when the day’s memories set.” — 12:34",
        "If no passage answers it fully, quote the one closest to it. Reply NONE only when the source given is empty.",
      ].join("\n");
    case "answer":
      return [
        ask.question
          ? `The writer asks you: ${ask.question}\nThe target lines are what they were on when they asked. Answer in one or two short sentences, plainly.`
          : "The writer asks you: the target lines are their question (or a line they want explained). Answer it in one or two short sentences, plainly.",
        source
          ? `When ${label} covers it, answer from it and end with " — " and the time or place the source gives, e.g. … — 12:34. When it doesn't, answer from what you know, without a time.`
          : "Answer from what you know. Say so plainly when you aren't sure.",
        ask.already.length
          ? `Your answers already here (go further, don't repeat them):\n${list(ask.already)}`
          : "",
      ].join("\n");
    case "mix":
      return [
        "Offer one unexpected mix for the target lines: a thing from a different field that sheds light on them.",
        "Reply as: × THING — how it connects, in one short clause.",
        ask.already.length ? `Mixes already given (don't repeat them):\n${list(ask.already)}` : "",
      ].join("\n");
    case "factQuery":
      return [
        "Write a search query for research papers that would support, test or add to the target lines.",
        "3 to 8 English words, the terms researchers would use. Reply with the query only.",
      ].join("\n");
    case "factRetry":
      return [
        "That search found nothing usable. Write a different, broader search query: 2 to 5 English words, the field's common terms.",
        "Reply with the query only.",
      ].join("\n");
    case "factWrite":
      return [
        "These research papers came back for the target lines, best first.",
        paperBlock(ask.papers),
        "Pick the first paper whose abstract supports a fact that fills a gap in the target lines. Write that fact in one sentence, using only what the abstract says.",
        'Reply with JSON only: {"paper": N, "fact": "…"}. If no abstract supports a useful fact, reply {"paper": 0}.',
        ask.already.length
          ? `Facts already given here (say something else):\n${list(ask.already)}`
          : "",
      ].join("\n");
    case "organize":
      return [
        "Reorganize the writer's lines below into a clearer structure: group related lines, put them in order, and nest each detail under the point it belongs to.",
        "Use their own words. Keep their phrases exactly as they wrote them; you may only reorder, regroup, indent, merge exact repeats, and add a few short group labels where a group needs a name. Never add an idea or drop one.",
        "A line may end with an id like ^yt-540 or ^ai-q-ab12: keep it at the end of the line whose words it ends.",
        "Reply with the Markdown lines only (bullets, nested bullets), no code fence, nothing else.",
        `<lines>\n${ask.block}\n</lines>`,
      ].join("\n");
    case "shorten":
      return [
        "Shorten each target line by cutting words only: filler, hedges, repetition. Never add, reorder or rewrite a word. Keep every idea and the meaning: cut words that add nothing, never a whole thought.",
        'Reply with JSON only: an array with one array per target line, in order, of the exact substrings to delete. Example for two lines: [["I think ", " basically"], []]. An empty array where every word is pulling its weight.',
      ].join("\n");
  }
}

export function penPrompt(input: PenPromptInput): string {
  const parts = [
    `<note title="${input.title.replace(/"/g, "'")}">\n${input.note}\n</note>`,
    input.lines.length ? `<target-lines>\n${input.lines.join("\n")}\n</target-lines>` : "",
    input.source && !input.ask.task.startsWith("fact") ? sourceBlock(input.source) : "",
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

/** The fact and its paper from a `factWrite` reply; null for none. */
export function factReply(
  reply: string,
  papers: readonly Paper[],
): { fact: string; paper: Paper } | null {
  const value = jsonIn(reply) as { paper?: unknown; fact?: unknown } | null;
  if (!value || typeof value.paper !== "number" || typeof value.fact !== "string") return null;
  const paper = papers[value.paper - 1];
  const fact = replyLine(value.fact);
  return paper && fact ? { fact, paper } : null;
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
export function cutsFromReply(reply: string, texts: readonly string[]): Cut[][] | null {
  const value = jsonIn(reply);
  if (!Array.isArray(value)) return null;
  return texts.map((text, k) => {
    const wanted = Array.isArray(value[k]) ? (value[k] as unknown[]) : [];
    const cuts: Cut[] = [];
    let from = 0;
    for (const item of wanted) {
      if (typeof item !== "string" || !item.trim()) continue;
      let at = text.indexOf(item, from);
      if (at < 0) at = text.indexOf(item);
      if (at < 0) continue;
      const cut = { from: at, to: at + item.length };
      if (cuts.some((c) => cut.from < c.to && cut.to > c.from)) continue;
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
