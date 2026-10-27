import type { HeardLine, TalkReply } from "./talk-agent";
import { formatMarkdownDestination } from "@/lib/paths";
import { timeLink } from "./transcript";

// Ask (SPECs/talk-notes-spec.md#while-you-talk-ask), as plain data in, data
// out: the talk's topics, which have a tab, which one the picture shows, and
// the new topic the pen is asking about.
//
// - The first topic opens without asking.
// - Turning to a new topic ("next", "moving on") makes an offer; keep talking
//   about it after the card shows (a line in a later reply) and the pen takes
//   it. Lines heard with the turn don't count: the card would never show.
// - A line said in passing about another topic waits on a badge.
// - Turning back to an open topic shows it again.

export interface Topic {
  key: string;
  title: string;
  short: string;
  /** The diagram, as Mermaid text; empty until the agent draws one. */
  mermaid: string;
  /** At most two sentences on what the talk said about it, for the note. */
  summary?: string;
  /** The heard lines about it, by number. */
  lines: number[];
}

/** Mind maps and flowcharts are drawn as boards; charts stay Arc charts. A
 *  topic that changes type follows its current one: its old board stays on
 *  disk but isn't shown or embedded. */
export function isBoardDiagram(mermaid: string | undefined): boolean {
  return /^\s*(mindmap|flowchart|graph)\b/.test(mermaid ?? "");
}

/** The pictures you can ask for by button, each named the way you'd say it. */
export const PICTURES = [
  { kind: "mindmap", says: "as a mind map" },
  { kind: "flowchart", says: "as steps" },
  { kind: "quadrantChart", says: "as a matrix" },
  { kind: "timeline", says: "as a timeline" },
  { kind: "xychart", says: "as a chart" },
] as const;

export type PictureKind = (typeof PICTURES)[number]["kind"];

/** Which of the buttons' pictures a diagram is, if any. */
export function pictureOf(mermaid: string | undefined): PictureKind | null {
  const head = /^\s*([A-Za-z-]+)/.exec(mermaid ?? "")?.[1];
  if (head === "graph") return "flowchart";
  if (head === "xychart-beta") return "xychart";
  return PICTURES.find((p) => p.kind === head)?.kind ?? null;
}

export interface AskState {
  topics: Record<string, Topic>;
  /** Topics with a tab, in the order they opened. */
  open: string[];
  /** The topic you're on: its picture shows. */
  current: string | null;
  /** The new topic the pen is asking about. */
  offer: { key: string; cue: string } | null;
  /** Topics you kept as asides from the card. */
  asides: string[];
  /** Lines said in passing about a topic without a tab. */
  parked: Record<string, number[]>;
  /** What each line was about. */
  lineTopic: Record<number, { topic: string; aside: boolean }>;
  /** The words of the last turn, for the status ("“Okay, next” · new topic"). */
  cue: string | null;
  /** The topic of the last line heard, so one line about another topic doesn't flip the picture. */
  last: string | null;
  /** The tab **next topic** opened, and the first line heard after it, until something is said into it. */
  started: { key: string; from: number } | null;
}

export const emptyAsk = (): AskState => ({
  topics: {},
  open: [],
  current: null,
  offer: null,
  asides: [],
  parked: {},
  lineTopic: {},
  cue: null,
  last: null,
  started: null,
});

const take = (s: AskState, key: string): AskState => ({
  ...s,
  open: s.open.includes(key) ? s.open : [...s.open, key],
  current: key,
  offer: s.offer?.key === key ? null : s.offer,
});

/** Folds one agent reply into the state. */
export function applyReply(prev: AskState, reply: TalkReply): AskState {
  let s: AskState = {
    ...prev,
    topics: { ...prev.topics },
    parked: { ...prev.parked },
    lineTopic: { ...prev.lineTopic },
  };
  // What you said after **next topic** is its topic, whatever key the AI gave it:
  // the empty tab becomes that topic, with no New topic? card.
  const started = s.started;
  if (started && isEmptyTopic(s.topics[started.key])) {
    const first = reply.lines.find((l) => l.topic && l.n >= started.from && !l.aside);
    const key = first?.topic;
    if (key && key !== started.key && !s.open.includes(key)) {
      delete s.topics[started.key];
      s.open = s.open.map((k) => (k === started.key ? key : k));
      if (s.current === started.key) s.current = key;
      s.started = { key, from: started.from };
    }
  }
  for (const t of reply.topics) {
    const old = s.topics[t.key];
    s.topics[t.key] = {
      key: t.key,
      title: t.title,
      short: t.short,
      mermaid: t.mermaid,
      summary: t.summary ?? old?.summary,
      lines: old?.lines ?? [],
    };
  }
  /** An offer made in this reply: its own lines don't take it. */
  let offeredNow: string | null = null;
  for (const line of reply.lines) {
    const key = line.topic;
    if (!key) continue;
    const topic = s.topics[key] ?? { key, title: key, short: key, mermaid: "", lines: [] };
    s.topics[key] = {
      ...topic,
      lines: topic.lines.includes(line.n) ? topic.lines : [...topic.lines, line.n],
    };
    s.lineTopic[line.n] = { topic: key, aside: Boolean(line.aside) };

    if (line.aside && !s.open.includes(key)) {
      s.parked[key] = [...(s.parked[key] ?? []), line.n];
      continue;
    }
    const isNew = !s.open.includes(key) && !s.asides.includes(key);
    if (isNew && (!s.current || !line.turn) && s.open.length === 0) {
      s = take(s, key);
      if (line.turn) s.cue = `“${line.turn}” · new topic`;
    } else if (isNew && line.turn) {
      s.offer = { key, cue: line.turn };
      s.cue = `“${line.turn}” · new topic`;
      offeredNow = key;
    } else if (s.offer?.key === key && offeredNow !== key) {
      s = take(s, key);
    } else if (s.open.includes(key) && s.current !== key && (line.turn || s.last === key)) {
      s.current = key;
      s.cue = line.turn ? `“${line.turn}”` : `Back to ${topic.short}`;
    }
    s.last = key;
  }
  if (s.started && !isEmptyTopic(s.topics[s.started.key])) s.started = null;
  return s;
}

/** The **next topic** button: a tab of its own now, titled once you talk about it. */
export function startTopic(s: AskState, key: string, from: number): AskState {
  const topic: Topic = { key, title: "New topic", short: "New topic", mermaid: "", lines: [] };
  return {
    ...take({ ...s, topics: { ...s.topics, [key]: topic } }, key),
    cue: null,
    started: { key, from },
  };
}

/** A topic with nothing in it yet: no lines heard and no picture. */
export const isEmptyTopic = (t: Topic | undefined): boolean =>
  !!t && !t.lines.length && !t.mermaid.trim();

/** The card's **Accept new tab**. */
export const acceptOffer = (s: AskState): AskState => (s.offer ? take(s, s.offer.key) : s);

/** The card's **Aside**: the topic stays in the transcript, with no tab. */
export const keepAside = (s: AskState): AskState =>
  s.offer ? { ...s, asides: [...s.asides, s.offer.key], offer: null } : s;

/** Tab text: what the topic holds so far. */
export function topicFill(t: Topic): string {
  const n = t.lines.length;
  return `${n} ${n === 1 ? "line" : "lines"}`;
}

/**
 * The talk's topics as markdown, for under the transcript
 * (SPECs/talk-notes-spec.md#the-note-after-a-stop): one `###` per topic with
 * a tab, its diagram and what was said about it with time links; lines
 * about topics without a tab under "Said in passing".
 */
export function talkSections(
  s: AskState,
  lines: HeardLine[],
  fileOf: (n: number) => { file: string; start: number },
  /** A topic drawn as a board: its `.board.svg`, relative to the note. */
  boardOf: (key: string) => string | null = () => null,
): string {
  const byN = new Map(lines.map((l) => [l.n, l]));
  const said = (n: number, prefix = "") => {
    const line = byN.get(n);
    if (!line) return null;
    const { file, start } = fileOf(n);
    return `- ${prefix}${line.text} ${timeLink(file, start)}`;
  };
  const out: string[] = [];
  for (const key of s.open) {
    const t = s.topics[key];
    // A topic started by button that nothing was said into.
    if (!t || isEmptyTopic(t)) continue;
    out.push(`### ${t.title}`, "");
    // What it came to, then its picture: the lines themselves are in the
    // transcript, and a board node plays the part of the take it came from.
    if (t.summary?.trim()) out.push(t.summary.trim(), "");
    const board = boardOf(key);
    if (board) out.push(`![${t.title}](${formatMarkdownDestination(board)})`, "");
    else if (t.mermaid.trim()) out.push("```mermaid", t.mermaid.trim(), "```", "");
  }
  const passing = Object.values(s.topics)
    .filter((t) => !s.open.includes(t.key))
    .flatMap((t) => t.lines)
    .sort((a, b) => a - b)
    .map((n) => said(n))
    .filter(Boolean) as string[];
  if (passing.length) out.push("### Said in passing", "", ...passing, "");
  return out.join("\n").trimEnd();
}
