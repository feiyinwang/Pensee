// The in-context tips (SPECs/in-context-tips-spec.md): one entry per tip, in
// the order they win when two are due. Adding a tip touches this file only
// (docs/consolidation.md): its anchor already reports arrivals, and its done
// test is a trace in the note or an app event the store already hears.
//
// Pure data and pure tests: no store, no DOM, so the triggers and done tests
// are unit-tested on their own (tests/tips.test.ts).

/** Where a tip's line sits: in the note (a CodeMirror placeholder) or on a
 *  page (a `<TipLine>` the page places itself). */
export type TipAnchor =
  | "editor"
  | "library"
  | "tabs"
  | "board"
  | "sidebar"
  | "projects"
  | "calendar";

/** What a note is, for the editor's tips. */
export type NoteKind = "note" | "youtube" | "podcast" | "book";

/** What an anchor knows when you arrive: the facts a trigger reads. The
 *  editor reports three moments: a note opening, the caret leaving a line,
 *  and a selection of several lines. */
export type TipArrival =
  | { anchor: "library"; items: number }
  | {
      anchor: "editor";
      moment: "open";
      path: string;
      /** A book's note reports this when its reader opens beside it. */
      kind: NoteKind;
    }
  | {
      anchor: "editor";
      moment: "leave-line";
      path: string;
      kind: NoteKind;
      /** The line the caret left, 0-based, and its text. */
      line: number;
      text: string;
      vaultNotes: number;
    }
  | { anchor: "editor"; moment: "select"; path: string; line: number; lines: number }
  | { anchor: "tabs"; count: number }
  | { anchor: "board" }
  | { anchor: "sidebar"; space: string; name: string; letter: string; clicks: number }
  | { anchor: "projects"; cards: number }
  | { anchor: "calendar" };

/** App events that finish a tip (the rest finish on a trace in the note). */
export type TipEvent =
  | "library-item-added"
  | "reader-opened"
  | "columns-on"
  | "card-docked"
  | "go-key"
  | "status-written"
  | "project-created"
  | "period-note-opened";

/** Live facts a tip's pill reads while it shows (the video's player). */
export interface TipLive {
  playing: boolean;
  /** The player's time, formatted (1:39:16). */
  time: string;
}

export interface TipKeys {
  keys: string[];
  label: string;
}

export interface Tip {
  id: string;
  anchor: TipAnchor;
  /** Whether this arrival is the tip's moment. `isDone` reads other tips
   *  (pen-check waits for pen-answer). */
  when: (arrival: TipArrival, isDone: (id: string) => boolean) => boolean;
  /** The faint line, where the move happens. */
  line: string;
  /** The move's keys, for the guide pill. None: the line ends in Not now. */
  keys?: (live: TipLive, arrival: TipArrival) => TipKeys;
  /** The one line that replaces the hint once it's done. */
  did: (live: TipLive) => string;
  /** How it is done: a trace in the note (also what the launch search over
   *  the vault looks for), or an app event. */
  done: { trace: RegExp } | { event: TipEvent };
  /** For an event-done tip: the trace in the vault that means the feature
   *  is already used. */
  vaultTrace?: RegExp | "board-file";
}

const editorMoment = <M extends "open" | "leave-line" | "select">(
  arrival: TipArrival,
  moment: M,
): (TipArrival & { anchor: "editor"; moment: M }) | null =>
  arrival.anchor === "editor" && arrival.moment === moment
    ? (arrival as TipArrival & { anchor: "editor"; moment: M })
    : null;

const words = (text: string): number =>
  text
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .split(/\s+/)
    .filter((w) => /\w/.test(w)).length;

/** A line of the writer's own: not one Pensée wrote (an `^ai-` id), not a
 *  heading, not frontmatter. */
const ownLine = (text: string): boolean =>
  !/\^ai-/.test(text) && !/^\s*#/.test(text) && !/^---\s*$/.test(text);

const isBullet = (text: string): boolean => /^\s*[-*+]\s+\S/.test(text);

const pinKeys = (live: TipLive): TipKeys => ({
  keys: ["⌘", "S"],
  label: live.playing ? `Pin to ${live.time}` : "Play",
});

export const TIPS: readonly Tip[] = [
  {
    id: "library-empty",
    anchor: "library",
    when: (a) => a.anchor === "library" && a.items === 0,
    line: "Try one: The Elements of Style.",
    did: () => "Added. It's on your shelf.",
    done: { event: "library-item-added" },
  },
  {
    id: "library-open",
    anchor: "library",
    when: (a) => a.anchor === "library" && a.items > 0,
    line: "Open a book: it reads beside its note.",
    did: () => "Its note opens beside the book.",
    done: { event: "reader-opened" },
    vaultTrace: /\^bk-/,
  },
  {
    id: "book-highlight",
    anchor: "editor",
    when: (a) => editorMoment(a, "open")?.kind === "book",
    line: "Select a line in the book. Highlighted, it lands here.",
    keys: () => ({ keys: ["H"], label: "Highlight the selected line" }),
    did: () => "Highlighted. Its pin in the note takes you back to the page.",
    done: { trace: /\^bk-/ },
  },
  {
    id: "video-pin",
    anchor: "editor",
    when: (a) => editorMoment(a, "open")?.kind === "youtube",
    line: "What stuck? Write it here and pin it to this moment.",
    keys: pinKeys,
    did: (live) => `Pinned to ${live.time}. Click the pin to watch it again.`,
    done: { trace: /\^yt-/ },
  },
  {
    id: "podcast-pin",
    anchor: "editor",
    when: (a) => editorMoment(a, "open")?.kind === "podcast",
    line: "What stuck? Write it here and pin it to this moment.",
    keys: pinKeys,
    did: (live) => `Pinned to ${live.time}. Click the pin to hear it again.`,
    done: { trace: /\^yt-/ },
  },
  {
    id: "pen-answer",
    anchor: "editor",
    when: (a) => {
      const left = editorMoment(a, "leave-line");
      return !!left && ownLine(left.text) && /\?\s*$/.test(left.text);
    },
    line: "Guess first, then see Pensée's answer.",
    keys: () => ({ keys: ["⌘", ".", "!"], label: "Answer" }),
    did: () => "Sealed until you write your guess. Then it opens.",
    done: { trace: /\^ai-s-/ },
  },
  {
    id: "pen-check",
    anchor: "editor",
    when: (a, isDone) => {
      const left = editorMoment(a, "leave-line");
      return (
        !!left &&
        isDone("pen-answer") &&
        ownLine(left.text) &&
        isBullet(left.text) &&
        !/\?\s*$/.test(left.text) &&
        words(left.text) >= 6
      );
    },
    line: "Is it true? Pensée finds papers for and against.",
    keys: () => ({ keys: ["⌘", ".", "@"], label: "Check" }),
    did: () => "Papers for and against land under your line.",
    done: { trace: /\^ai-[pn]-/ },
  },
  {
    id: "pen-connect",
    anchor: "editor",
    when: (a) => {
      const left = editorMoment(a, "leave-line");
      return !!left && left.vaultNotes >= 20 && ownLine(left.text) && words(left.text) >= 6;
    },
    line: "Written about this before? Pensée finds your notes on it.",
    keys: () => ({ keys: ["⌘", ".", "["], label: "Connect" }),
    did: () => "Your notes on it land under your line.",
    done: { trace: /\^ai-e-/ },
  },
  {
    id: "pen-organize",
    anchor: "editor",
    when: (a) => (editorMoment(a, "select")?.lines ?? 0) >= 3,
    line: "Sort these into topics, in your words.",
    keys: () => ({ keys: ["⌘", ".", "#"], label: "Organize" }),
    did: () => "Sorted into topics, in your words.",
    done: { trace: /\^ai-g-/ },
  },
  {
    id: "tabs-pinch",
    anchor: "tabs",
    when: (a) => a.anchor === "tabs" && a.count >= 3,
    line: "See them side by side.",
    keys: () => ({ keys: [], label: "Pinch in" }),
    did: () => "Every tab, side by side. Pinch out for one.",
    done: { event: "columns-on" },
  },
  {
    id: "board-dock",
    anchor: "board",
    when: (a) => a.anchor === "board",
    line: "Drag a card near another to join them.",
    did: () => "Joined. The arrow links the two.",
    done: { event: "card-docked" },
    vaultTrace: "board-file",
  },
  {
    id: "go-key",
    anchor: "sidebar",
    when: (a) => a.anchor === "sidebar" && a.clicks >= 3 && a.letter !== "",
    line: "From anywhere",
    // The row's own letter and name.
    keys: (_, a) =>
      a.anchor === "sidebar"
        ? { keys: ["⌘", "G", a.letter], label: `Go to ${a.name}` }
        : { keys: ["⌘", "G"], label: "Go" },
    did: () => "Any row: ⌘G and its letter.",
    done: { event: "go-key" },
  },
  {
    id: "projects-move",
    anchor: "projects",
    when: (a) => a.anchor === "projects" && a.cards > 0,
    line: "Drag a card to change its status.",
    did: () => "Its Status: is written in its note.",
    done: { event: "status-written" },
  },
  {
    id: "projects-empty",
    anchor: "projects",
    when: (a) => a.anchor === "projects" && a.cards === 0,
    line: "Select plans in any note, right-click, Add to Projects.",
    did: () => "It's on the board.",
    done: { event: "project-created" },
  },
  {
    id: "calendar-period",
    anchor: "calendar",
    when: (a) => a.anchor === "calendar",
    line: "Click a week, month or year for its note.",
    did: () => "Every week, month and year has its own note.",
    done: { event: "period-note-opened" },
  },
];

const BY_ID = new Map(TIPS.map((tip) => [tip.id, tip]));

export function tipById(id: string): Tip | null {
  return BY_ID.get(id) ?? null;
}

/** The first tip due at `arrival`, in the registry's order: its anchor, not
 *  done, shown fewer than `maxShown` times, and its trigger holds. */
export function dueTip(
  arrival: TipArrival,
  isDone: (id: string) => boolean,
  shown: (id: string) => number,
  maxShown = 2,
): Tip | null {
  for (const tip of TIPS) {
    if (tip.anchor !== arrival.anchor) continue;
    if (isDone(tip.id) || shown(tip.id) >= maxShown) continue;
    if (tip.when(arrival, isDone)) return tip;
  }
  return null;
}

/** The trace-done tips a line of the note finishes: what the editor tests
 *  the lines it changed against. */
export function tipsFinishedBy(text: string): string[] {
  if (!text.includes("^")) return [];
  const ids: string[] = [];
  for (const tip of TIPS) {
    if ("trace" in tip.done && tip.done.trace.test(text)) ids.push(tip.id);
  }
  return ids;
}

/** The tips an app event finishes. */
export function tipsFinishedByEvent(event: TipEvent): string[] {
  return TIPS.filter((tip) => "event" in tip.done && tip.done.event === event).map((t) => t.id);
}

/** What the one launch search over the vault looks for. */
export interface VaultTraces {
  /** The lines it found. */
  lines: string[];
  /** Whether a `.board.svg` is anywhere in the vault. */
  hasBoard: boolean;
}

/** The pattern the launch search greps the vault for: every trace above. */
export const VAULT_TRACE_PATTERN = "\\^(yt|bk|ai)-";

/** The tips the vault already shows as used. */
export function tipsUsedInVault(traces: VaultTraces): string[] {
  const ids = new Set<string>();
  for (const line of traces.lines) for (const id of tipsFinishedBy(line)) ids.add(id);
  for (const tip of TIPS) {
    if (tip.vaultTrace === "board-file" && traces.hasBoard) ids.add(tip.id);
    const trace = tip.vaultTrace;
    if (trace instanceof RegExp && traces.lines.some((line) => trace.test(line))) ids.add(tip.id);
  }
  return [...ids];
}
