import {
  Annotation,
  ChangeSet,
  type ChangeSpec,
  EditorState,
  type Extension,
  Prec,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type TooltipView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  showTooltip,
} from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";

import { blockIdsInText } from "@/lib/block-refs";
import { bookFileOf } from "@/lib/book-highlights";
import { openBookPassages } from "@/lib/book-readers";
import { getFileStem } from "@/lib/paths";
import {
  type Citation,
  type Cut,
  type PenKind,
  type PenSource,
  applyCuts,
  bodyEnd,
  bodyStart,
  childIndent,
  childrenOf,
  citationsIn,
  connectTerms,
  contentWords,
  cutsFromReply,
  echoLine,
  echoQuote,
  echoedNotes,
  echoesReply,
  isItem,
  isPenParagraph,
  isQuestion,
  organizedReply,
  itemText,
  newPenId,
  noteForPen,
  parentOf,
  penKindOf,
  penLabelEnd,
  penLineSlot,
  penPrompt,
  pinnedSecond,
  replyLine,
  compareReply,
  isNonsenseTake,
  penIdOf,
  sealedAbove,
  sideLine,
  sidesReply,
  sourcePartStart,
  subtreeEnd,
  unsealedLine,
  videoPassages,
  wordCount,
} from "@/lib/second-pen";
import { type PenConversation, penConversation, warmPen } from "@/lib/second-pen-agent";
import { findLinesMentioning, searchPapers } from "@/lib/tauri";
import { formatVideoTime, isBlankLine, videoIdOf } from "@/lib/video-pins";
import { videoPlayerFor } from "@/lib/video-players";
import { hasTranscript, transcriptIn } from "@/lib/video-transcript";
import { useEditorStore } from "@/stores/editor-store";
import { hoverCard } from "./hover-card";
import type { PenPill } from "./pen-box";
import { type PenHint, type PenHintPart, setPenHint } from "./pen-hint-store";
import "./second-pen.css";

// The second pen in the editor (SPECs/second-pen-spec.md): ⌘. opens its box
// on the selection or the caret's line; it answers only after your take
// (sealed), checks a claim on both sides, and brings back what you wrote in
// other notes, always right under that line, and Enter / Esc carry each flow.
// Everything a flow knows is read back from the document (`lib/second-pen.ts`),
// so undo, edits and reloads never leave it confused. The bottom bar says what
// applies.

/** The pen's own edits: allowed while shorten locks the lines. */
const penEdit = Annotation.define<true>();
const setLock = StateEffect.define<boolean>();
/** Redraw: the plugin's own state (armed, a message, cuts) changed. */
const refresh = StateEffect.define<null>();

/** Shorten's cuts are on screen: the text waits for Enter or Esc. */
const lockField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setLock)) value = effect.value;
    return value;
  },
});

const lockFilter = EditorState.transactionFilter.of((tr) =>
  tr.docChanged && tr.startState.field(lockField) && !tr.annotation(penEdit) ? [] : tr,
);

/** ⌘. opens the pen's box above the lines it will act on: pills for what it
 *  can do, and a box under them to ask it something or steer it. */
const setPop = StateEffect.define<{ pos: number } | null>();
const pens = new WeakMap<EditorView, PenPlugin>();

const popField = StateField.define<{ pos: number } | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setPop)) return effect.value;
    return value && tr.docChanged ? { pos: tr.changes.mapPos(value.pos) } : value;
  },
  provide: (field) =>
    showTooltip.from(field, (pop) =>
      pop
        ? {
            pos: pop.pos,
            above: true,
            strictSide: false,
            create: (view) => pens.get(view)!.popView(),
          }
        : null,
    ),
});

/** Where the pen's line will land, while it writes: "Writing a question…"
 *  right there, so you see it working where you're looking; then, for a
 *  moment, what it has to say when it writes nothing. */
interface Pending {
  /** End of the line the pen's line will follow. */
  pos: number;
  /** List depth of the line to come (0 = top level). */
  depth: number;
  bullet: boolean;
  text: string;
  busy: boolean;
  /** Keys to show after a message, such as ↵ keep / Esc put back. */
  keys?: Array<[string, string]>;
}

const setPending = StateEffect.define<Pending | null>();

class PendingWidget extends WidgetType {
  constructor(readonly pending: Pending) {
    super();
  }

  eq(other: PendingWidget): boolean {
    const a = this.pending;
    const b = other.pending;
    return (
      a.text === b.text &&
      a.busy === b.busy &&
      a.depth === b.depth &&
      a.bullet === b.bullet &&
      JSON.stringify(a.keys) === JSON.stringify(b.keys)
    );
  }

  toDOM(): HTMLElement {
    const { depth, bullet, text, busy } = this.pending;
    const row = document.createElement("div");
    row.className = busy ? "cm-pen-pending" : "cm-pen-pending cm-pen-pending-said";
    row.setAttribute("role", "status");
    // The list's own geometry: 3ch per level, the marker in the last slot.
    row.style.setProperty("--cm-pen-pending-indent", `${depth * 3}ch`);
    if (bullet) {
      const mark = document.createElement("span");
      mark.className = "cm-pen-pending-mark";
      mark.textContent = "◦";
      mark.setAttribute("aria-hidden", "true");
      row.append(mark);
    }
    const label = document.createElement("span");
    label.className = "cm-pen-pending-text";
    label.textContent = text;
    row.append(label);
    const keys = busy ? [["Esc", "stop"] as [string, string]] : (this.pending.keys ?? []);
    if (keys.length) {
      const hint = document.createElement("span");
      hint.className = "cm-pen-pending-keys";
      for (const [key, what] of keys) {
        const kbd = document.createElement("kbd");
        kbd.textContent = key;
        hint.append(kbd, ` ${what} `);
      }
      row.append(hint);
    }
    return row;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const pendingField = StateField.define<Pending | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setPending)) return effect.value;
    return value && tr.docChanged ? { ...value, pos: tr.changes.mapPos(value.pos) } : value;
  },
  // Block widgets come from state, not a view plugin.
  provide: (field) =>
    EditorView.decorations.from(field, (pending) =>
      pending
        ? Decoration.set([
            Decoration.widget({ widget: new PendingWidget(pending), block: true, side: 1 }).range(
              pending.pos,
            ),
          ])
        : Decoration.none,
    ),
});

let boxPrefetched = false;
/** Load the box's code while the editor is idle, so ⌘. opens it at once. */
function prefetchPenBox(): void {
  if (boxPrefetched) return;
  boxPrefetched = true;
  const load = () =>
    import("./pen-box").catch((error: unknown) =>
      console.error("[pen] box prefetch failed", error),
    );
  if (typeof window.requestIdleCallback === "function")
    window.requestIdleCallback(load, { timeout: 3000 });
  else window.setTimeout(load, 500);
}

/** The pills that write a line of the pen's: with something typed, the typed
 *  line goes in first and theirs under it. */
const WRITES_TYPED = new Set(["!", "@", "["]);

const MESSAGE_MS = 4_000;
const AFTER_MS = 5_000;
const FRESH_MS = 1_200;
const WORD_STAGGER_MS = 22;

const SOURCE_LABEL = { video: "the video", book: "the book" } as const;

const REST: PenHintPart[] = [
  { key: "⌘ ." },
  { text: "answer, check or connect the line you're on" },
];
const TAKE: PenHintPart[] = [
  { key: "↵" },
  { text: "open it and compare" },
  { gap: true },
  { key: "⌥ ↵" },
  { text: "open it without writing" },
];
const TAKE_EMPTY: PenHintPart[] = [
  { text: "Your take first" },
  { gap: true },
  { key: "⌥ ↵" },
  { text: "open it without writing" },
  { gap: true },
  { key: "Esc" },
  { text: "take it back" },
];
/** What an empty line of yours waits for, by the pen line it hangs under. */
const WAITING: Partial<Record<PenKind, string>> = {
  s: "Your take first…",
  n: "Your call: does your line hold? Rewrite it or keep it.",
};
const SEALED_LABEL = "Sealed · write your take under it · ⌥↵ open it now";

type Placement =
  /** Right under the anchor line: a sub-bullet, or a plain line below a
   *  paragraph or heading. */
  | { mode: "under"; pos: number }
  /** The empty line at `pos` becomes the pen line. */
  | { mode: "slot"; pos: number };

interface ShortenLine {
  /** Where the line's words start; the text is locked while cuts show. */
  from: number;
  text: string;
  cuts: Array<Cut & { kept: boolean }>;
}

// One split per version of the text, shared by the hint, Enter and requests.
const splitCache = new WeakMap<EditorState["doc"], string[]>();

function docLines(state: EditorState): string[] {
  let lines = splitCache.get(state.doc);
  if (!lines) {
    lines = state.doc.toString().split("\n");
    splitCache.set(state.doc, lines);
  }
  return lines;
}

function caretIndex(state: EditorState): number {
  return state.doc.lineAt(state.selection.main.head).number - 1;
}

/** The lines a request is about: every line the selection touches, or the
 *  caret's. 0-based. */
function targetIndexes(state: EditorState): number[] {
  const { from, to, empty } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  if (empty) return [first - 1];
  let last = state.doc.lineAt(to).number;
  if (last > first && state.doc.line(last).from === to) last--;
  return Array.from({ length: last - first + 1 }, (_, k) => first - 1 + k);
}

/** The note's properties, from the editor store (the body has none). */
function frontmatterOf(path: string): string | null {
  return useEditorStore.getState().openFiles.get(path)?.frontmatter ?? null;
}

/** Whether `?` quizzes: a video note with a transcript, or a book note. */
function sourceKind(path: string, body: string): PenSource["kind"] | null {
  const frontmatter = frontmatterOf(path);
  if (videoIdOf(frontmatter) && hasTranscript(body)) return "video";
  if (bookFileOf(frontmatter)) return "book";
  return null;
}

async function readSource(
  path: string,
  body: string,
  lines: readonly string[],
  anchor: number | null,
): Promise<{ source: PenSource | null; focus: string | null }> {
  const kind = sourceKind(path, body);
  if (kind === "video") {
    const player = videoPlayerFor(path);
    const focus = anchor === null ? null : pinnedSecond(lines, anchor);
    // A video not played yet (watched elsewhere, or notes from the transcript)
    // counts as seen whole.
    const time = player?.time() ?? 0;
    const passages = videoPassages(transcriptIn(body), time > 0 ? time : Infinity, focus);
    return {
      source: { kind, label: SOURCE_LABEL.video, passages },
      focus: focus === null ? null : formatVideoTime(focus),
    };
  }
  if (kind === "book") {
    const passages = (await openBookPassages())
      .filter((p) => p.notePath === path)
      .map((p) => ({ where: p.where, text: p.text }));
    return { source: { kind, label: SOURCE_LABEL.book, passages }, focus: null };
  }
  return { source: null, focus: null };
}

function lineRange(state: EditorState, first: number, last: number): { from: number; to: number } {
  const start = state.doc.line(first + 1);
  const end = state.doc.line(last + 1);
  // A plain pen line is a blank line apart from what's above: take both.
  if (isPenParagraph(start.text) && first > 0 && !state.doc.line(first).text.trim()) {
    return { from: Math.max(0, start.from - 2), to: end.to };
  }
  // Take the line break before the lines (or after them, at the top).
  return start.from > 0
    ? { from: start.from - 1, to: end.to }
    : { from: 0, to: Math.min(state.doc.length, end.to + 1) };
}

/** A paper citation after a fact: a pill that opens the paper; hovering it
 *  shows the paper (`citationCard`). Its Markdown comes back when the caret
 *  reaches it. */
class CitationWidget extends WidgetType {
  constructor(readonly citation: Citation) {
    super();
  }

  eq(other: CitationWidget): boolean {
    return other.citation.url === this.citation.url && other.citation.label === this.citation.label;
  }

  toDOM(): HTMLElement {
    const { citation } = this;
    const chip = document.createElement("span");
    chip.className = "cm-pen-cite";
    chip.setAttribute("role", "link");
    chip.setAttribute("aria-label", `Open ${citation.title ?? citation.label}`);
    for (const [key, value] of Object.entries({
      url: citation.url,
      title: citation.title,
      authors: citation.authors,
      venue: citation.venue,
      citedBy: citation.citedBy,
    })) {
      if (value) chip.dataset[key] = value;
    }
    const icon = document.createElement("span");
    icon.className = "cm-pen-cite-icon";
    icon.setAttribute("aria-hidden", "true");
    chip.append(icon, document.createTextNode(citation.label));
    chip.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPaper(citation.url);
    });
    return chip;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** Faint words on an empty line of yours that the pen is waiting on. */
class WaitingWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: WaitingWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-pen-waiting";
    span.textContent = this.text;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** After a sealed answer's blurred words: what opens it. */
class SealWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-pen-seal";
    span.textContent = SEALED_LABEL;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** A side of a check with no paper: said, so it never reads as cited. */
class NoPaperWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-pen-nopaper";
    span.textContent = "no paper";
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function openPaper(url: string): void {
  void openUrl(url).catch((error: unknown) =>
    console.error("[pen] Couldn't open the paper:", error),
  );
}

/** Hovering a paper's pill shows everything about it: the details the note
 *  keeps in the link, and the link itself. */
const citationCard = hoverCard({
  selector: ".cm-pen-cite",
  className: "cm-pen-cite-card",
  width: 380,
  maxHeight: 320,
  build: async (chip) => {
    const { url, title, authors, venue, citedBy } = chip.dataset;
    if (!url) return null;
    const card = document.createDocumentFragment();
    const add = (cls: string, text: string | undefined) => {
      if (!text) return;
      const row = document.createElement("div");
      row.className = cls;
      row.textContent = text;
      card.append(row);
    };
    add("cm-pen-cite-card-host", new URL(url).host.replace(/^www\./, ""));
    add("cm-pen-cite-card-title", title ?? url);
    add("cm-pen-cite-card-meta", authors);
    add("cm-pen-cite-card-meta", venue);
    add("cm-pen-cite-card-meta", citedBy ? citedBy.replace(/^cited by/, "Cited by") : undefined);
    add("cm-pen-cite-card-url", url);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "cm-pen-cite-card-open";
    open.textContent = "Open paper";
    open.addEventListener("click", () => openPaper(url));
    card.append(open);
    return { element: card, label: `Paper: ${title ?? url}` };
  },
});

class PenPlugin {
  decorations: DecorationSet = Decoration.none;
  /** The citation pills, for the editor's atomic ranges. */
  cites: DecorationSet = Decoration.none;
  private citeRanges: Range<Decoration>[] = [];
  private armed: number[] | null = null;
  private conversation: PenConversation | null = null;
  private busyLabel = "Writing…";
  private shortening: ShortenLine[] | null = null;
  /** Shorten's last step: Enter asked "Delete these words?"; Enter again
   *  deletes them, Esc goes back to reviewing the cuts. */
  private confirming = false;
  private fresh: DecorationSet = Decoration.none;
  private message: { parts: PenHintPart[]; until: number } | null = null;
  private after: { parts: PenHintPart[]; until: number } | null = null;
  /** The facts or mixes the last request wrote: what Esc takes back. */
  private batch: string[] = [];
  /** Where the running request writes, kept current as the text changes. */
  private placement: Placement | null = null;
  /** Organize's outline, in place of your lines until Enter keeps it or Esc
   *  puts them back. */
  private organizing: { from: number; to: number; original: string } | null = null;
  /** The line you typed in the box, just written: the request about to run
   *  writes under it. `context` is the lines it was typed on. */
  private typed: { pos: number; context: number[] } | null = null;
  /** Where the last request showed its progress: its message goes there too. */
  private spot: Omit<Pending, "text" | "busy"> | null = null;
  private timers = new Set<number>();
  private destroyed = false;

  constructor(
    readonly view: EditorView,
    readonly getFilePath: () => string,
  ) {
    pens.set(view, this);
    prefetchPenBox();
    this.decorations = this.build();
    this.publish();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.fresh = this.fresh.map(update.changes);
      if (this.placement) {
        this.placement = { ...this.placement, pos: update.changes.mapPos(this.placement.pos) };
      }
      const typed = update.transactions.some((tr) => tr.docChanged && !tr.annotation(penEdit));
      if (typed) this.batch = [];
      if (typed && this.armed) this.disarm();
    }
    // The text moved under the box: what it was for is gone.
    if (this.armed && update.selectionSet && !update.docChanged) this.disarm();
    // Esc takes back the last facts or mixes only until you move on.
    if (update.selectionSet && !update.transactions.some((tr) => tr.annotation(penEdit))) {
      this.batch = [];
    }
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      update.focusChanged ||
      update.transactions.some((tr) => tr.effects.some((e) => e.is(refresh) || e.is(setLock)))
    ) {
      this.decorations = this.build();
      this.publish();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.conversation?.cancel();
    for (const timer of this.timers) clearTimeout(timer);
    setPenHint(this.getFilePath(), null);
  }

  /* ---------------------------------------------------------- redraw */

  private redraw(): void {
    if (this.destroyed) return;
    this.view.dispatch({ effects: refresh.of(null) });
  }

  private later(ms: number, run: () => void): void {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, ms);
    this.timers.add(timer);
  }

  private say(text: string): void {
    this.message = { parts: [{ text }], until: Date.now() + MESSAGE_MS };
    this.later(MESSAGE_MS + 20, () => this.redraw());
    // After a request: said where its line would have gone, then gone.
    const spot = this.spot;
    this.spot = null;
    if (spot && !this.destroyed) {
      const pending: Pending = { ...spot, text, busy: false };
      this.view.dispatch({ effects: setPending.of(pending) });
      this.later(MESSAGE_MS, () => {
        // Only this message: a request started since owns the spot now.
        if (!this.destroyed && this.view.state.field(pendingField) === pending) {
          this.view.dispatch({ effects: setPending.of(null) });
        }
      });
    }
    this.redraw();
  }

  private sayAfter(parts: PenHintPart[]): void {
    this.after = { parts, until: Date.now() + AFTER_MS };
    this.later(AFTER_MS + 20, () => this.redraw());
  }

  private build(): DecorationSet {
    const { state } = this.view;
    const ranges: Range<Decoration>[] = [];
    this.citeRanges = [];
    for (const { from, to } of this.view.visibleRanges) {
      for (let pos = from; pos <= to; ) {
        const line = state.doc.lineAt(pos);
        const kind = penKindOf(line.text);
        if (kind) this.decorateLine(ranges, line.from, line.text, kind);
        else if (isItem(line.text) && isBlankLine(line.text)) this.decorateWaiting(ranges, line);
        pos = line.to + 1;
      }
    }
    if (this.armed) {
      for (const i of this.armed) {
        const line = state.doc.line(i + 1);
        const start = line.from + bodyStart(line.text);
        const end = line.from + bodyEnd(line.text);
        if (end > start) ranges.push(Decoration.mark({ class: "cm-pen-armed" }).range(start, end));
      }
    }
    this.shortening?.forEach((line, l) =>
      line.cuts.forEach((cut, c) => {
        ranges.push(
          Decoration.mark({
            class: cut.kept ? "cm-pen-cut cm-pen-cut-kept" : "cm-pen-cut",
            attributes: { "data-pen-cut": `${l}:${c}`, title: "Click to keep these words" },
          }).range(line.from + cut.from, line.from + cut.to),
        );
      }),
    );
    // Organize's outline: whole lines tinted. A mark across them would wrap
    // each bullet's marker and knock the list's geometry out of place.
    if (this.organizing && this.organizing.to > this.organizing.from) {
      const last = state.doc.lineAt(this.organizing.to).number;
      for (let n = state.doc.lineAt(this.organizing.from).number; n <= last; n++) {
        ranges.push(Decoration.line({ class: "cm-pen-organized" }).range(state.doc.line(n).from));
      }
    }
    const cursor = this.fresh.iter();
    for (; cursor.value; cursor.next()) ranges.push(cursor.value.range(cursor.from, cursor.to));
    this.cites = Decoration.set(this.citeRanges, true);
    return Decoration.set(ranges, true);
  }

  private decorateLine(
    ranges: Range<Decoration>[],
    from: number,
    text: string,
    kind: PenKind,
  ): void {
    ranges.push(Decoration.line({ class: `cm-pen-line cm-pen-${kind}` }).range(from));
    const start = bodyStart(text);
    const end = bodyEnd(text);
    if (kind === "s" && end > start) {
      // Unreadable until your take is written; what opens it, after.
      ranges.push(Decoration.mark({ class: "cm-pen-sealed" }).range(from + start, from + end));
      ranges.push(Decoration.widget({ widget: new SealWidget(), side: 1 }).range(from + end));
      return;
    }
    if (kind === "p" || kind === "n" || kind === "e") {
      // What the line is (For, Against, Supports…): quieter than what it says.
      const label = penLabelEnd(text.slice(start));
      if (label !== null) {
        ranges.push(
          Decoration.mark({ class: "cm-pen-side" }).range(from + start, from + start + label),
        );
      }
    }
    if (kind === "p" || kind === "n") {
      if (citationsIn(text).length === 0 && end > start) {
        ranges.push(Decoration.widget({ widget: new NoPaperWidget(), side: 1 }).range(from + end));
      }
    }
    if (kind === "f" || kind === "p" || kind === "n") {
      // Always the pill, never its Markdown: the paper's details live in the
      // hover card. Atomic (`cites`), so Backspace takes it whole.
      for (const citation of citationsIn(text)) {
        const pill = Decoration.replace({ widget: new CitationWidget(citation) }).range(
          from + citation.from,
          from + citation.to,
        );
        ranges.push(pill);
        this.citeRanges.push(pill);
      }
    }
    if (kind === "c" || kind === "f" || kind === "r") {
      const body = text.slice(start, end);
      const at = sourcePartStart(body);
      if (at !== null && citationsIn(body).length === 0) {
        ranges.push(Decoration.mark({ class: "cm-pen-src" }).range(from + start + at, from + end));
      }
    }
  }

  /** An empty bullet of yours under a pen line that waits for it: its words,
   *  faint, where you'll type. */
  private decorateWaiting(
    ranges: Range<Decoration>[],
    line: { from: number; to: number; number: number },
  ): void {
    const lines = docLines(this.view.state);
    const parent = parentOf(lines, line.number - 1);
    const kind = parent >= 0 ? penKindOf(lines[parent]!) : null;
    const text = kind ? WAITING[kind] : undefined;
    if (text)
      ranges.push(Decoration.widget({ widget: new WaitingWidget(text), side: 1 }).range(line.to));
  }

  /* ------------------------------------------------------------ hint */

  private hint(): PenHint | null {
    const { state } = this.view;
    const now = Date.now();
    // The box above the text says it all while it's open.
    if (this.armed) return null;
    if (this.conversation) {
      return {
        busy: true,
        parts: [{ text: this.busyLabel }, { gap: true }, { key: "Esc" }, { text: "stop" }],
      };
    }
    if (this.shortening) {
      const saved = this.savedWords();
      if (this.confirming) {
        return {
          parts: [
            { strong: `Delete ${saved} ${saved === 1 ? "word" : "words"}?` },
            { gap: true },
            { key: "↵" },
            { text: "delete" },
            { key: "Esc" },
            { text: "keep reviewing" },
          ],
        };
      }
      return {
        parts: [
          { strong: `−${saved} words` },
          { text: "Only cuts. Click a cut to keep it." },
          { gap: true },
          { key: "↵" },
          { text: "shorten" },
          { key: "Esc" },
          { text: "cancel" },
        ],
      };
    }
    if (this.message && now < this.message.until) return { parts: this.message.parts };
    const caretLine = state.doc.lineAt(state.selection.main.head).text;
    // Only a list line can be a take or a pen line: skip the rest cheaply.
    if (state.selection.main.empty && this.caretInNote() && isItem(caretLine)) {
      const lines = docLines(state);
      const i = caretIndex(state);
      if (sealedAbove(lines, i) >= 0) return { parts: itemText(lines[i]!) ? TAKE : TAKE_EMPTY };
      const kind = penKindOf(lines[i]!);
      if (kind && kind !== "s") return { parts: [{ key: "↵" }, { text: "reply under it" }] };
    }
    if (this.after && now < this.after.until) return { parts: this.after.parts };
    return this.caretInNote() ? { parts: REST, resting: true } : null;
  }

  /** The caret is in this note (the window itself may be in the back). */
  private caretInNote(): boolean {
    return this.view.contentDOM.contains(document.activeElement);
  }

  private publish(): void {
    if (this.destroyed) return;
    setPenHint(this.getFilePath(), this.hint());
  }

  /* ------------------------------------------------------------ keys */

  arm(): void {
    if (this.shortening || this.organizing) return;
    if (this.conversation) {
      this.say("The pen is still writing. Esc stops it.");
      return;
    }
    warmPen();
    const { state } = this.view;
    this.armed = targetIndexes(state);
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.from);
    const pos = sel.empty ? line.from + Math.min(bodyStart(line.text), line.length) : sel.from;
    this.view.dispatch({ effects: [setPop.of({ pos }), refresh.of(null)] });
  }

  /** Close the box. From inside an update it waits for the next tick. */
  disarm(): void {
    if (!this.armed) return;
    this.armed = null;
    queueMicrotask(() => {
      if (!this.destroyed) this.view.dispatch({ effects: [setPop.of(null), refresh.of(null)] });
    });
  }

  private closePop(refocus: boolean): void {
    this.armed = null;
    if (this.destroyed) return;
    this.view.dispatch({ effects: [setPop.of(null), refresh.of(null)] });
    if (refocus) this.view.focus();
  }

  isArmed(): boolean {
    return this.armed !== null;
  }

  /** What the box offers for the lines it opened on. */
  private pills(): PenPill[] {
    const { state } = this.view;
    const lines = docLines(state);
    const withText = (this.armed ?? []).filter((i) => itemText(lines[i]!));
    const answer = {
      key: "!",
      label: "Answer",
      title: "The AI answers, sealed until you've written your own take.",
    };
    if (!withText.length) return [answer];
    return [
      answer,
      {
        key: "@",
        label: "Check",
        title: "The evidence for and against the line. You make the call.",
      },
      { key: "[[", label: "Connect", title: "What you wrote before, in other notes, on this." },
      { key: "−", label: "Shorten", title: "Proposes cuts. Nothing is added." },
      // Only with several lines selected: there's something to regroup.
      ...(withText.length > 1
        ? [
            {
              key: "#",
              label: "Organize",
              title: "Regroups the selected lines, in your own words.",
            },
          ]
        : []),
    ];
  }

  /** The box: Arc's pills on top, the box to type in under them (pen-box.tsx,
   *  loaded on first use). */
  popView(): TooltipView {
    const dom = document.createElement("div");
    dom.className = "cm-pen-pop";
    dom.setAttribute("role", "dialog");
    dom.setAttribute("aria-label", "Second pen");
    let unmount: (() => void) | null = null;
    let gone = false;
    const pills = this.pills();
    void import("./pen-box")
      .then(({ mountPenBox }) => {
        if (gone) return;
        unmount = mountPenBox(dom, {
          pills,
          onChoose: (key, text) => this.choose(key, text),
          onClose: () => this.closePop(true),
        });
      })
      .catch((error: unknown) => {
        console.error("[pen] Couldn't load the pen's box:", error);
        this.closePop(true);
        this.say("Couldn't open the pen's box.");
      });
    // Clicking away closes it; moving between its own pills doesn't.
    dom.addEventListener("focusout", () => {
      setTimeout(() => {
        if (this.armed && !dom.contains(document.activeElement) && !this.view.hasFocus) {
          this.closePop(false);
        }
      }, 0);
    });
    return {
      dom,
      // A little air between the box and the words it's about.
      offset: { x: 0, y: 6 },
      destroy: () => {
        gone = true;
        // React can't unmount during CodeMirror's own DOM update.
        const done = unmount;
        if (done) queueMicrotask(done);
      },
    };
  }

  /** The typed line for the request starting now, once: its index, and the
   *  lines it was typed on for context. */
  private takeTyped(): { line: number; context: number[] } | null {
    const typed = this.typed;
    this.typed = null;
    if (!typed) return null;
    return {
      line: this.view.state.doc.lineAt(Math.min(typed.pos, this.view.state.doc.length)).number - 1,
      context: typed.context,
    };
  }

  /** A pill, with what was typed: a direction, or for Answer the question. */
  private choose(key: string, typed: string): void {
    const text = typed.trim();
    this.closePop(true);
    // What you typed goes in the note first, as your own line under the line
    // you're on (or on the empty line), and what the pen writes goes under it.
    // Shorten and Organize change your lines: for them it only steers.
    if (text && WRITES_TYPED.has(key === "[[" ? "[" : key) && !this.conversation) {
      const { state } = this.view;
      const lines = docLines(state);
      const targets = targetIndexes(state).filter((i) => itemText(lines[i]!));
      const placement: Placement = targets.length
        ? { mode: "under", pos: state.doc.line(targets[targets.length - 1]! + 1).from }
        : { mode: "slot", pos: state.doc.line(caretIndex(state) + 1).from };
      const { lineFrom } = this.writeLine(null, text, placement);
      this.typed = { pos: lineFrom, context: targets };
    }
    switch (key) {
      case "!":
        void this.reply(text);
        break;
      case "@":
        void this.check(text);
        break;
      case "[[":
        void this.connect(text);
        break;
      case "#":
        void this.organize(text);
        break;
      case "−":
        void this.shorten(text);
        break;
    }
  }

  /** Esc: stop the pen, take back what you haven't answered, or nothing. */
  escape(): boolean {
    if (this.armed) {
      this.closePop(true);
      return true;
    }
    if (this.shortening) {
      this.shortenKey("Escape");
      return true;
    }
    if (this.conversation) {
      this.conversation.cancel();
      this.conversation = null;
      this.placement = null;
      this.view.dispatch({ effects: setPending.of(null) });
      this.say("Stopped.");
      return true;
    }
    return this.takeBack();
  }

  /** Enter on a pen line, or on your take under a sealed answer (⌥↵ opens
   *  it without a comparison); false for a plain Enter. */
  enter(alt = false): boolean {
    const { state } = this.view;
    if (!state.selection.main.empty || this.shortening) return false;
    const lines = docLines(state);
    const i = caretIndex(state);
    const sealed = sealedAbove(lines, i);
    if (sealed >= 0) {
      if (this.conversation) return true;
      if (alt) void this.open(sealed, i, false);
      else if (!itemText(lines[i]!))
        this.say("A wrong guess counts. Write anything first, or ⌥↵ to open it now.");
      else void this.open(sealed, i, true);
      return true;
    }
    if (alt) return false;
    const kind = penKindOf(lines[i]!);
    if (kind && kind !== "s") {
      this.answerUnder(i);
      return true;
    }
    return false;
  }

  clickCut(target: HTMLElement): boolean {
    const at = target.closest<HTMLElement>("[data-pen-cut]")?.dataset.penCut;
    if (!at || !this.shortening) return false;
    const [l, c] = at.split(":").map(Number);
    const cut = this.shortening[l!]?.cuts[c!];
    if (!cut) return false;
    cut.kept = !cut.kept;
    // Changing the cuts goes back to reviewing them.
    if (this.confirming) this.askConfirm(false);
    else this.redraw();
    return true;
  }

  /** The words the cuts still marked would remove. */
  private savedWords(): number {
    return (this.shortening ?? []).reduce(
      (n, line) =>
        n +
        wordCount(line.text) -
        wordCount(
          applyCuts(
            line.text,
            line.cuts.filter((c) => !c.kept),
          ),
        ),
      0,
    );
  }

  /** Shorten's keys: Enter asks to confirm, then deletes; Esc steps back
   *  (from the question to the cuts, from the cuts to your lines as they
   *  were). */
  shortenKey(key: "Enter" | "Escape"): void {
    if (key === "Enter") {
      if (this.confirming || this.savedWords() === 0) this.endShorten(this.confirming);
      else this.askConfirm(true);
    } else if (this.confirming) this.askConfirm(false);
    else this.endShorten(false);
  }

  /** The question, right under the last line being shortened, or gone. */
  private askConfirm(on: boolean): void {
    this.confirming = on;
    const last = this.shortening?.[this.shortening.length - 1];
    let pending: Pending | null = null;
    if (on && last) {
      const saved = this.savedWords();
      pending = {
        ...this.spotFor({ mode: "under", pos: this.view.state.doc.lineAt(last.from).from }),
        text: `Delete ${saved} ${saved === 1 ? "word" : "words"}?`,
        busy: false,
        keys: [
          ["↵", "delete"],
          ["Esc", "keep reviewing"],
        ],
      };
    }
    this.view.dispatch({ effects: [setPending.of(pending), refresh.of(null)] });
  }

  isShortening(): boolean {
    return this.shortening !== null;
  }

  isOrganizing(): boolean {
    return this.organizing !== null;
  }

  /** Enter keeps the outline; Esc puts your lines back as they were. */
  endOrganize(keep: boolean): void {
    const organized = this.organizing;
    if (!organized) return;
    this.organizing = null;
    this.view.dispatch({
      changes: keep ? [] : [{ from: organized.from, to: organized.to, insert: organized.original }],
      effects: [setLock.of(false), setPending.of(null), refresh.of(null)],
      annotations: penEdit.of(true),
      userEvent: "input.pen",
    });
  }

  endShorten(apply: boolean): void {
    const lines = this.shortening;
    if (!lines) return;
    this.shortening = null;
    this.confirming = false;
    const changes: ChangeSpec[] = apply
      ? lines.map((line) => ({
          from: line.from,
          to: line.from + line.text.length,
          insert: applyCuts(
            line.text,
            line.cuts.filter((c) => !c.kept),
          ),
        }))
      : [];
    this.view.dispatch({
      changes,
      effects: [setLock.of(false), setPending.of(null), refresh.of(null)],
      annotations: penEdit.of(true),
      userEvent: "input.pen",
    });
  }

  /* -------------------------------------------------------- requests */

  /** A request starts: its conversation, and its progress shown where its
   *  line will land (`at`), or under the line it reads. */
  private start(label: string, at: Placement): PenConversation {
    this.conversation = penConversation();
    this.busyLabel = label;
    this.message = null;
    this.placement = at;
    this.spot = this.spotFor(at);
    this.view.dispatch({
      effects: [setPending.of({ ...this.spot, text: label, busy: true }), refresh.of(null)],
    });
    return this.conversation;
  }

  private relabel(label: string): void {
    this.busyLabel = label;
    if (this.spot && !this.destroyed) {
      this.view.dispatch({
        effects: [setPending.of({ ...this.spot, text: label, busy: true }), refresh.of(null)],
      });
    }
  }

  private finish(conversation: PenConversation): void {
    conversation.end();
    if (this.conversation === conversation) this.conversation = null;
    if (!this.destroyed) this.view.dispatch({ effects: [setPending.of(null), refresh.of(null)] });
  }

  /** Where a line written at `placement` would go: after which line, how deep. */
  private spotFor(placement: Placement): Omit<Pending, "text" | "busy"> {
    const { state } = this.view;
    const lines = docLines(state);
    const anchor = state.doc.lineAt(Math.min(placement.pos, state.doc.length)).number - 1;
    const depthOf = (i: number) => {
      let depth = 0;
      for (let j = i; j >= 0 && isItem(lines[j]!); j = parentOf(lines, j)) depth++;
      return depth;
    };
    if (placement.mode === "slot" && isBlankLine(lines[anchor]!)) {
      const item = isItem(lines[anchor]!);
      return {
        pos: state.doc.line(anchor + 1).to,
        depth: Math.max(0, depthOf(anchor) - 1),
        bullet: item,
      };
    }
    const slot = penLineSlot(lines, anchor);
    return {
      pos: state.doc.line(slot.after + 1).to,
      depth: slot.kind === "bullet" ? depthOf(anchor) : 0,
      bullet: slot.kind === "bullet",
    };
  }

  private fail(conversation: PenConversation, error: unknown): void {
    const stopped = this.conversation !== conversation;
    this.placement = null;
    this.finish(conversation);
    if (stopped) return;
    console.error("[pen]", error);
    this.say(error instanceof Error ? error.message : String(error));
  }

  private promptBase(lines: readonly string[], targets: number[], direction = "") {
    const path = this.getFilePath();
    return {
      title: getFileStem(path),
      note: noteForPen(this.view.state.doc.toString()),
      lines: targets.map((i) => itemText(lines[i]!)).filter(Boolean),
      path,
      direction: direction || undefined,
    };
  }

  /** `!`: you ask, the pen answers, sealed: unreadable, with an empty take
   *  under it, until you've written yours. What you typed in the box is your
   *  question: it goes into the note under the line you're on (or on the
   *  empty line), and the answer under it. With nothing typed, the line itself
   *  is the question. Again on the same line for one more that goes further. */
  private async reply(question = ""): Promise<void> {
    const typed = this.takeTyped();
    const { state } = this.view;
    const lines = docLines(state);
    const path = this.getFilePath();
    const targets = typed ? typed.context : targetIndexes(state).filter((i) => itemText(lines[i]!));
    if (!question && !targets.length) {
      this.say("Type your question in the box, or put the caret on it.");
      return;
    }
    let anchorPos: number;
    let already: string[] = [];
    if (question && typed) {
      anchorPos = state.doc.line(typed.line + 1).from;
    } else if (question) {
      const caret = caretIndex(state);
      const placement: Placement = targets.length
        ? { mode: "under", pos: state.doc.line(targets[targets.length - 1]! + 1).from }
        : { mode: "slot", pos: state.doc.line(caret + 1).from };
      anchorPos = this.writeLine(null, question, placement).lineFrom;
    } else {
      const anchor = targets[targets.length - 1]!;
      anchorPos = state.doc.line(anchor + 1).from;
      already = childrenOf(lines, anchor)
        .filter((j) => {
          const kind = penKindOf(lines[j]!);
          return kind === "r" || kind === "s";
        })
        .map((j) => itemText(lines[j]!));
    }
    const conversation = this.start("Writing an answer…", { mode: "under", pos: anchorPos });
    try {
      const now = docLines(this.view.state);
      const anchor = this.view.state.doc.lineAt(anchorPos).number - 1;
      const body = this.view.state.doc.toString();
      const { source } =
        sourceKind(path, body) !== null
          ? await readSource(path, body, now, anchor)
          : { source: null };
      const reply = await conversation.send(
        penPrompt({
          ...this.promptBase(now, question ? targets : [anchor]),
          source: source?.passages.length ? source : null,
          ask: { task: "answer", already, question: question || undefined },
        }),
      );
      const text = replyLine(reply, true);
      if (!text) {
        this.placement = null;
        this.finish(conversation);
        this.say("That's all I have on this line. The rest is yours.");
        return;
      }
      // Sealed, with your take under it: the caret waits there.
      this.write("s", text, "child");
      this.finish(conversation);
    } catch (error) {
      this.fail(conversation, error);
    }
  }

  /** `#`: the selected lines regrouped into an outline in your own words, in
   *  their place, until Enter keeps it or Esc puts your lines back. */
  private async organize(direction = ""): Promise<void> {
    const { state } = this.view;
    const lines = docLines(state);
    const targets = targetIndexes(state);
    const withText = targets.filter((i) => itemText(lines[i]!));
    if (withText.length < 2) {
      this.say("Select the lines to organize first.");
      return;
    }
    const first = targets[0]!;
    const last = targets[targets.length - 1]!;
    const block = lines.slice(first, last + 1).join("\n");
    const from = state.doc.line(first + 1).from;
    const to = state.doc.line(last + 1).to;
    const conversation = this.start("Organizing your lines…", {
      mode: "under",
      pos: state.doc.line(last + 1).from,
    });
    this.placement = null;
    try {
      const reply = await conversation.send(
        penPrompt({
          ...this.promptBase(lines, withText, direction),
          source: null,
          ask: { task: "organize", block },
        }),
      );
      this.finish(conversation);
      const organized = organizedReply(reply);
      if (!organized) {
        this.say("Couldn't organize these lines. Try again.");
        return;
      }
      if (this.view.state.doc.sliceString(from, to) !== block) {
        this.say("The lines changed while the pen read them. Try again.");
        return;
      }
      this.spot = null;
      this.organizing = { from, to: from + organized.length, original: block };
      this.view.dispatch({
        changes: { from, to, insert: organized },
        annotations: penEdit.of(true),
        userEvent: "input.pen",
        effects: [
          setLock.of(true),
          setPending.of({
            pos: from + organized.length,
            // Lined up with the outline's words: past the bullets' slot.
            depth: isItem(organized.split("\n")[0] ?? "") ? 1 : 0,
            bullet: false,
            text: "Organized, in your words.",
            busy: false,
            keys: [
              ["↵", "keep"],
              ["Esc", "put mine back"],
            ],
          }),
          refresh.of(null),
        ],
        scrollIntoView: true,
      });
    } catch (error) {
      this.fail(conversation, error);
    }
  }

  /** `−`: cuts on the lines, struck through until Enter or Esc. */
  private async shorten(direction = ""): Promise<void> {
    const { state } = this.view;
    const lines = docLines(state);
    const targets = targetIndexes(state).filter((i) => itemText(lines[i]!));
    if (!targets.length) {
      this.say("Put the caret on a line, or select some, first.");
      return;
    }
    const texts = targets.map((i) => lines[i]!.slice(bodyStart(lines[i]!), bodyEnd(lines[i]!)));
    // No line to write: the progress shows under the last line it reads.
    const conversation = this.start("Finding words to cut…", {
      mode: "under",
      pos: state.doc.line(targets[targets.length - 1]! + 1).from,
    });
    this.placement = null;
    try {
      const reply = await conversation.send(
        penPrompt({
          ...this.promptBase(lines, targets, direction),
          source: null,
          ask: { task: "shorten" },
        }),
      );
      this.finish(conversation);
      const cuts = cutsFromReply(reply, texts);
      // The text moved while it read: its cuts no longer line up.
      const now = docLines(this.view.state);
      const moved = targets.some(
        (i, k) => now[i]?.slice(bodyStart(now[i]!), bodyEnd(now[i]!)) !== texts[k],
      );
      if (!cuts || moved) {
        this.say(
          moved
            ? "The lines changed while the pen read them. Try again."
            : "Couldn't shorten this. Try again.",
        );
        return;
      }
      if (cuts.every((c) => c.length === 0)) {
        this.say("Nothing to cut. Every word is pulling its weight.");
        return;
      }
      this.shortening = targets
        .map((i, k) => ({
          from: this.view.state.doc.line(i + 1).from + bodyStart(now[i]!),
          text: texts[k]!,
          cuts: cuts[k]!.map((cut) => ({ ...cut, kept: false })),
        }))
        .filter((line) => line.cuts.length);
      this.view.dispatch({ effects: [setLock.of(true), refresh.of(null)] });
    } catch (error) {
      this.fail(conversation, error);
    }
  }

  /** Enter on your take: the pen first reads it. A real attempt (wrong is
   *  fine) opens the sealed answer (its id says `r` from now on) and the pen
   *  writes how the two differ under your take, with an empty line under that
   *  for yours. Gibberish or something unrelated keeps it sealed. ⌥↵ opens it
   *  without either: an empty take goes. */
  private async open(sealed: number, take: number, compare: boolean): Promise<void> {
    const lines = docLines(this.view.state);
    const takeText = itemText(lines[take]!);
    if (!compare) {
      this.unseal(sealed, takeText ? null : take);
      return;
    }
    const notATake =
      "That doesn't read as a take on this question. Write what you really think: a wrong guess counts.";
    if (isNonsenseTake(takeText)) {
      this.say(notATake);
      return;
    }
    const parent = parentOf(lines, sealed);
    const question =
      parent >= 0 ? itemText(lines[parent]!) : itemText(lines[Math.max(0, sealed - 2)]!);
    const answer = itemText(lines[sealed]!);
    const takePos = this.view.state.doc.line(take + 1).from;
    const conversation = this.start("Reading your take…", { mode: "under", pos: takePos });
    try {
      const judged = compareReply(
        await conversation.send(
          penPrompt({
            ...this.promptBase(lines, parent >= 0 ? [parent] : []),
            source: null,
            ask: { task: "compare", question, answer, take: takeText },
          }),
        ),
      );
      if (!judged || !judged.real) {
        this.placement = null;
        this.finish(conversation);
        this.say(judged ? notATake : "Couldn't read your take. Try again.");
        return;
      }
      // The lines may have moved while it read: find the answer by its id.
      const at = this.lineOfId(penIdOf(lines[sealed]!));
      if (at === null) {
        this.placement = null;
        this.finish(conversation);
        return;
      }
      this.unseal(at, null);
      if (judged.text) this.write("v", judged.text, "child");
      else this.placement = null;
      this.finish(conversation);
    } catch (error) {
      this.fail(conversation, error);
    }
  }

  /** The sealed answer at `sealed` opens; `dropTake` goes with it. */
  private unseal(sealed: number, dropTake: number | null): void {
    const { state } = this.view;
    const line = state.doc.line(sealed + 1);
    const changes: ChangeSpec[] = [
      { from: line.from, to: line.to, insert: unsealedLine(line.text) },
    ];
    if (dropTake !== null) changes.push(lineRange(state, dropTake, dropTake));
    const set = state.changes(changes);
    this.view.dispatch({
      changes: set,
      selection: dropTake !== null ? { anchor: set.mapPos(line.to) } : undefined,
      annotations: penEdit.of(true),
      userEvent: "input.pen",
    });
  }

  /** The 0-based line that ends with `^id`, or null. */
  private lineOfId(id: string | null): number | null {
    if (!id) return null;
    const at = docLines(this.view.state).findIndex((line) => line.endsWith(`^${id}`));
    return at < 0 ? null : at;
  }

  /** `@`: the evidence for and against the line, from papers, and an empty
   *  line under it for your call. Never a verdict. */
  private async check(direction = ""): Promise<void> {
    const typedContext = this.takeTyped()?.context ?? [];
    const { state } = this.view;
    const lines = docLines(state);
    const targets = targetIndexes(state).filter((i) => itemText(lines[i]!));
    if (!targets.length) {
      this.say("Put the caret on a line, or select some, first.");
      return;
    }
    const anchor = targets[targets.length - 1]!;
    if (targets.every((i) => isQuestion(itemText(lines[i]!)))) {
      this.say("That's a question, not a claim. Nothing to check.");
      return;
    }
    const conversation = this.start("Finding papers…", {
      mode: "under",
      pos: state.doc.line(anchor + 1).from,
    });
    try {
      const base = {
        ...this.promptBase(lines, [...typedContext, ...targets], direction),
        source: null,
      };
      // One more never cites a paper already there.
      const cited = new Set(
        childrenOf(lines, anchor)
          .filter((j) => {
            const kind = penKindOf(lines[j]!);
            return kind === "p" || kind === "n" || kind === "f";
          })
          .flatMap((j) => citationsIn(lines[j]!).map((c) => c.url)),
      );
      let found: ReturnType<typeof sidesReply> = null;
      let searched = false;
      // A query that finds nothing usable gets one broader try.
      for (const ask of [{ task: "factQuery" }, { task: "factRetry" }] as const) {
        const query = replyLine(await conversation.send(penPrompt({ ...base, ask })));
        const papers = query
          ? (await searchPapers(query)).filter((paper) => !cited.has(paper.url))
          : [];
        if (!papers.length) continue;
        searched = true;
        this.relabel("Reading the papers…");
        found = sidesReply(
          await conversation.send(penPrompt({ ...base, ask: { task: "sides", papers } })),
          papers,
        );
        if (found) break;
      }
      if (!found) {
        this.placement = null;
        this.finish(conversation);
        this.say(searched ? "No paper speaks to this line." : "No paper found for this line.");
        return;
      }
      const at = this.placement;
      const forId = this.write("p", sideLine("For", found.pro));
      this.placement = at && { ...at, pos: this.mapped(at.pos) };
      // Your call waits under the evidence against.
      const againstId = this.write("n", sideLine("Against", found.con), "child");
      this.batch = [forId, againstId].filter((id): id is string => !!id);
      this.finish(conversation);
    } catch (error) {
      this.fail(conversation, error);
    }
  }

  /** `[`: lines you wrote in other notes that meet this one, each linked to
   *  its note and saying what it is. They stay until you remove them. */
  private async connect(direction = ""): Promise<void> {
    const typedContext = this.takeTyped()?.context ?? [];
    const { state } = this.view;
    const lines = docLines(state);
    const targets = targetIndexes(state).filter((i) => itemText(lines[i]!));
    if (!targets.length) {
      this.say("Put the caret on a line, or select some, first.");
      return;
    }
    const anchor = targets[targets.length - 1]!;
    const conversation = this.start("Reading your notes…", {
      mode: "under",
      pos: state.doc.line(anchor + 1).from,
    });
    try {
      const base = {
        ...this.promptBase(lines, [...typedContext, ...targets], direction),
        source: null,
      };
      // The pen's words for the idea, and the line's own: a search that never
      // rests on the pen's choice alone.
      const terms = [
        ...new Set([
          ...connectTerms(
            await conversation.send(penPrompt({ ...base, ask: { task: "connectQuery" } })),
          ),
          ...contentWords(base.lines),
        ]),
      ].slice(0, 16);
      // A note already echoed under the line isn't offered again.
      const shown = echoedNotes(
        childrenOf(lines, anchor)
          .filter((j) => penKindOf(lines[j]!) === "e")
          .map((j) => lines[j]!),
      );
      const found = terms.length ? await findLinesMentioning(terms, this.getFilePath(), 40) : [];
      const candidates = found
        .map((line) => ({ note: line.stem, text: echoQuote(line.text) }))
        .filter((c) => c.text.length >= 12 && !shown.has(c.note));
      const picked = candidates.length
        ? echoesReply(
            await conversation.send(
              penPrompt({ ...base, ask: { task: "connectPick", candidates } }),
            ),
            candidates.length,
          )
        : [];
      if (!picked.length) {
        this.placement = null;
        this.finish(conversation);
        this.say(
          candidates.length
            ? "Your notes mention this, but nothing that meets this line yet."
            : "None of your other notes mention this yet.",
        );
        return;
      }
      const at = this.placement;
      const ids: string[] = [];
      for (const echo of picked) {
        const c = candidates[echo.index]!;
        this.placement = at && { ...at, pos: this.mapped(at.pos) };
        const id = this.write("e", echoLine(echo, c.text, c.note));
        if (id) ids.push(id);
      }
      this.batch = ids;
      this.finish(conversation);
      this.sayAfter([{ key: "Esc" }, { text: "take them back" }]);
    } catch (error) {
      this.fail(conversation, error);
    }
  }

  /** A position from before the last pen write, where it is now: writes only
   *  ever add text after it, so it stays put. */
  private mapped(pos: number): number {
    return Math.min(pos, this.view.state.doc.length);
  }

  /* ---------------------------------------------------------- writing */

  /** Writes one pen line where the running request's placement says, now
   *  that the text may have moved. `answer` adds an empty answer bullet: as
   *  the pen line's child, or after the anchor's subtree (the next answer,
   *  beside the one the pen line hangs under). Returns the pen line's id. */
  private write(
    kind: PenKind,
    text: string,
    answer: "child" | "next" | null = null,
  ): string | null {
    const placement = this.placement;
    this.placement = null;
    // Written: nothing more to say where it landed.
    this.spot = null;
    if (!placement || this.destroyed) return null;
    const id = newPenId(kind, new Set(blockIdsInText(this.view.state.doc.toString())));
    const { textFrom } = this.writeLine(id, text, placement, answer);
    this.markFresh(textFrom, text);
    return id;
  }

  /**
   * One line right under the placement's line: a sub-bullet under a bullet,
   * a plain line under a paragraph, or the empty line itself. A pen line when
   * `id` is given, your own line (a question you typed in the box) when null.
   * Returns where the line and its words start.
   */
  private writeLine(
    id: string | null,
    text: string,
    placement: Placement,
    answer: "child" | "next" | null = null,
  ): { lineFrom: number; textFrom: number } {
    const { state } = this.view;
    const lines = docLines(state);
    const anchor = state.doc.lineAt(Math.min(placement.pos, state.doc.length)).number - 1;
    const tail = id ? ` ^${id}` : "";
    const bullet = (indent: string) => `${indent}- ${text}${tail}`;
    const plain = `${text}${tail}`;
    let insert: { from: number; to: number; text: string };
    let textFrom: number;
    let lineFrom: number;
    let written: string;
    const anchorLine = lines[anchor]!;
    if (placement.mode === "slot" && isBlankLine(anchorLine)) {
      const line = state.doc.line(anchor + 1);
      if (isItem(anchorLine)) {
        const indent = /^\s*/.exec(line.text)![0];
        written = bullet(indent);
        insert = { from: line.from, to: line.to, text: written };
        lineFrom = line.from;
        textFrom = line.from + indent.length + 2;
      } else {
        // A blank line becomes a plain line, kept apart from its neighbours.
        written = plain;
        insert = { from: line.from, to: line.to, text: `\n${written}\n` };
        lineFrom = textFrom = line.from + 1;
      }
    } else {
      const slot = penLineSlot(lines, anchor);
      const end = state.doc.line(slot.after + 1).to;
      if (slot.kind === "bullet") {
        written = bullet(slot.indent);
        insert = { from: end, to: end, text: `\n${written}` };
        lineFrom = end + 1;
        textFrom = end + 1 + slot.indent.length + 2;
      } else {
        written = plain;
        insert = { from: end, to: end, text: `\n\n${written}${slot.blankAfter ? "\n" : ""}` };
        lineFrom = textFrom = end + 2;
      }
    }
    const set = ChangeSet.of(
      { from: insert.from, to: insert.to, insert: insert.text },
      state.doc.length,
    );
    const lineEnd = textFrom + text.length + tail.length;
    let all = set;
    let caret: number | undefined;
    if (answer === "child") {
      const add = `\n${childIndent(written)}- `;
      all = set.compose(ChangeSet.of({ from: lineEnd, insert: add }, set.newLength));
      caret = lineEnd + add.length;
    } else if (answer === "next") {
      const after = set.apply(state.doc);
      const at = after.line(subtreeEnd(after.toString().split("\n"), anchor) + 1).to;
      const add = `\n${/^\s*/.exec(anchorLine)![0]}- `;
      all = set.compose(ChangeSet.of({ from: at, insert: add }, set.newLength));
      caret = at + add.length;
    }
    this.view.dispatch({
      changes: all,
      selection: caret === undefined ? (id ? undefined : { anchor: lineEnd }) : { anchor: caret },
      annotations: penEdit.of(true),
      userEvent: "input.pen",
      scrollIntoView: true,
    });
    return { lineFrom, textFrom };
  }

  /** The words just written fade in, one after another. */
  private markFresh(from: number, text: string): void {
    const marks: Range<Decoration>[] = [];
    let k = 0;
    for (const match of text.matchAll(/\S+/g)) {
      marks.push(
        Decoration.mark({
          class: "cm-pen-word",
          attributes: { style: `animation-delay:${k++ * WORD_STAGGER_MS}ms` },
        }).range(from + match.index, from + match.index + match[0].length),
      );
    }
    this.fresh = Decoration.set(marks, true);
    this.redraw();
    this.later(FRESH_MS + k * WORD_STAGGER_MS, () => {
      this.fresh = Decoration.none;
      this.redraw();
    });
  }

  /** Enter on a pen line: an answer bullet under it, after its answers.
   *  Nothing else changes: the lines beside it stay. */
  private answerUnder(i: number): void {
    const { state } = this.view;
    const lines = docLines(state);
    const end = state.doc.line(subtreeEnd(lines, i) + 1).to;
    const set = state.changes({ from: end, insert: `\n${childIndent(lines[i]!)}- ` });
    this.batch = [];
    this.view.dispatch({
      changes: set,
      selection: { anchor: set.mapPos(end, 1) },
      annotations: penEdit.of(true),
      userEvent: "input.pen",
      scrollIntoView: true,
    });
  }

  private takeBack(): boolean {
    const { state } = this.view;
    const lines = docLines(state);
    const i = caretIndex(state);
    const line = lines[i]!;
    if (state.selection.main.empty && isItem(line) && !itemText(line) && !penKindOf(line)) {
      const parent = parentOf(lines, i);
      const parentKind = parent >= 0 ? penKindOf(lines[parent]!) : null;
      // An empty line the pen is waiting on, its only child: take back what
      // it waits on (the sealed answer, the echo, or both sides of a check).
      if ((parentKind === "s" || parentKind === "n") && childrenOf(lines, parent).length === 1) {
        let first = parent;
        if (parentKind === "n") {
          const siblings = isPenParagraph(lines[parent]!)
            ? parent >= 2 && penKindOf(lines[parent - 2]!) === "p"
              ? [parent - 2]
              : []
            : childrenOf(lines, parentOf(lines, parent)).filter(
                (j) => j < parent && penKindOf(lines[j]!) === "p" && subtreeEnd(lines, j) === j,
              );
          first = siblings.length ? siblings[siblings.length - 1]! : parent;
        }
        this.removeLines(first, i, null);
        return true;
      }
    }
    if (this.batch.length) {
      const doomed = lines
        .map((text, j) => ({ text, j }))
        .filter(
          ({ text, j }) =>
            this.batch.some((id) => text.endsWith(`^${id}`)) && subtreeEnd(lines, j) === j,
        )
        .reverse();
      this.batch = [];
      if (!doomed.length) return false;
      this.view.dispatch({
        changes: doomed.map(({ j }) => lineRange(state, j, j)),
        annotations: penEdit.of(true),
        userEvent: "delete.pen",
      });
      return true;
    }
    return false;
  }

  private removeLines(first: number, last: number, restore: string | null): void {
    const { state } = this.view;
    const range = restore
      ? { from: state.doc.line(first + 1).from, to: state.doc.line(last + 1).to }
      : lineRange(state, first, last);
    const set = state.changes({ ...range, insert: restore ?? "" });
    this.view.dispatch({
      changes: set,
      selection: {
        anchor: restore ? range.from + restore.length : Math.max(0, set.mapPos(range.from, -1)),
      },
      annotations: penEdit.of(true),
      userEvent: "delete.pen",
    });
  }
}

/** The second pen for the main editor. */
export function secondPen(getFilePath: () => string): Extension {
  const plugin: ViewPlugin<PenPlugin> = ViewPlugin.define(
    (view) => new PenPlugin(view, getFilePath),
    {
      decorations: (p) => p.decorations,
      eventHandlers: {
        keydown(event: KeyboardEvent, view: EditorView): boolean {
          if (event.isComposing) return false;
          const pen = view.plugin(plugin);
          if (!pen) return false;
          const mod = event.metaKey || event.ctrlKey;
          if (pen.isOrganizing()) {
            if (event.key === "Enter") pen.endOrganize(true);
            else if (event.key === "Escape") pen.endOrganize(false);
            else return false;
            event.preventDefault();
            event.stopPropagation();
            return true;
          }
          if (pen.isShortening()) {
            if (event.key === "Enter" || event.key === "Escape") pen.shortenKey(event.key);
            else return false;
            event.preventDefault();
            event.stopPropagation();
            return true;
          }
          if (
            mod &&
            !event.altKey &&
            !event.shiftKey &&
            (event.key === "." || event.code === "Period")
          ) {
            event.preventDefault();
            if (pen.isArmed()) pen.escape();
            else pen.arm();
            return true;
          }
          if (event.key === "Escape" && !mod && pen.escape()) {
            event.preventDefault();
            event.stopPropagation();
            return true;
          }
          if (event.key === "Enter" && !event.shiftKey && !mod && pen.enter(event.altKey)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        mousedown(event: MouseEvent, view: EditorView): boolean {
          const pen = view.plugin(plugin);
          if (!pen) return false;
          if (event.target instanceof HTMLElement && pen.clickCut(event.target)) {
            event.preventDefault();
            return true;
          }
          if (pen.isArmed()) pen.escape();
          return false;
        },
      },
    },
  );
  return [
    lockField,
    lockFilter,
    popField,
    pendingField,
    Prec.highest(plugin),
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.cites ?? Decoration.none),
    citationCard,
  ];
}
