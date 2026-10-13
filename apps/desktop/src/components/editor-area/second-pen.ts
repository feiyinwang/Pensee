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
  type PenAsk,
  type PenKind,
  type PenSource,
  answerStep,
  applyCuts,
  bodyEnd,
  bodyStart,
  childIndent,
  childrenOf,
  citationMarkdown,
  citationsIn,
  cutsFromReply,
  factReply,
  isItem,
  isPenParagraph,
  itemText,
  newPenId,
  noteForPen,
  parentOf,
  penKindOf,
  penLineSlot,
  penPrompt,
  pinnedSecond,
  questionAbove,
  replyLine,
  sourcePartStart,
  subtreeEnd,
  unansweredSiblingMixes,
  videoPassages,
  wordCount,
} from "@/lib/second-pen";
import { type PenConversation, penConversation, warmPen } from "@/lib/second-pen-agent";
import { searchPapers } from "@/lib/tauri";
import { formatVideoTime, isBlankLine, videoIdOf } from "@/lib/video-pins";
import { videoPlayerFor } from "@/lib/video-players";
import { hasTranscript, transcriptIn } from "@/lib/video-transcript";
import { useEditorStore } from "@/stores/editor-store";
import { hoverCard } from "./hover-card";
import { type PenHint, type PenHintPart, setPenHint } from "./pen-hint-store";
import "./second-pen.css";

// The second pen in the editor (SPECs/second-pen-spec.md): ⌘. arms it for
// one key on the selection or the caret's line, it writes one line under
// that line, and Enter / Esc carry the answer flow. Everything it knows about
// a quiz is read back from the document (`lib/second-pen.ts`), so undo, edits
// and reloads never leave it confused. The bottom bar says what applies.

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

const MESSAGE_MS = 4_000;
const AFTER_MS = 5_000;
const FRESH_MS = 1_200;
const WORD_STAGGER_MS = 22;

const SOURCE_LABEL = { video: "the video", book: "the book" } as const;

const REST: PenHintPart[] = [
  { key: "⌘ ." },
  { text: "ask, or be asked, about the selection or the line you're on" },
];
const ANSWER: PenHintPart[] = [
  { key: "↵" },
  { text: "answer" },
  { gap: true },
  { key: "↵" },
  { text: "on an empty line: I don't know" },
  { gap: true },
  { key: "Esc" },
  { text: "take it back" },
];

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

function openPaper(url: string): void {
  void openUrl(url).catch((error: unknown) =>
    console.error("[pen] Couldn't open the paper:", error),
  );
}

const citationCard = hoverCard({
  selector: ".cm-pen-cite",
  className: "cm-pen-cite-card",
  width: 360,
  maxHeight: 260,
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
    add("cm-pen-cite-card-meta", [venue, citedBy].filter(Boolean).join(" · "));
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
  private armed: number[] | null = null;
  private conversation: PenConversation | null = null;
  private busyLabel = "Writing…";
  private shortening: ShortenLine[] | null = null;
  private fresh: DecorationSet = Decoration.none;
  private message: { parts: PenHintPart[]; until: number } | null = null;
  private after: { parts: PenHintPart[]; until: number } | null = null;
  /** The facts or mixes the last request wrote: what Esc takes back. */
  private batch: string[] = [];
  /** Questions that took the place of an empty line: taking one back gives
   *  the line back. */
  private slotQuestions = new Set<string>();
  /** Where the running request writes, kept current as the text changes. */
  private placement: Placement | null = null;
  private timers = new Set<number>();
  private destroyed = false;

  constructor(
    readonly view: EditorView,
    readonly getFilePath: () => string,
  ) {
    pens.set(view, this);
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
    this.redraw();
  }

  private sayAfter(parts: PenHintPart[]): void {
    this.after = { parts, until: Date.now() + AFTER_MS };
    this.later(AFTER_MS + 20, () => this.redraw());
  }

  private build(): DecorationSet {
    const { state } = this.view;
    const ranges: Range<Decoration>[] = [];
    const sel = state.selection.main;
    for (const { from, to } of this.view.visibleRanges) {
      for (let pos = from; pos <= to; ) {
        const line = state.doc.lineAt(pos);
        const kind = penKindOf(line.text);
        if (kind) this.decorateLine(ranges, line.from, line.text, kind, sel);
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
    const cursor = this.fresh.iter();
    for (; cursor.value; cursor.next()) ranges.push(cursor.value.range(cursor.from, cursor.to));
    return Decoration.set(ranges, true);
  }

  private decorateLine(
    ranges: Range<Decoration>[],
    from: number,
    text: string,
    kind: PenKind,
    sel: { from: number; to: number },
  ): void {
    ranges.push(Decoration.line({ class: `cm-pen-line cm-pen-${kind}` }).range(from));
    const start = bodyStart(text);
    const end = bodyEnd(text);
    if (kind === "f") {
      for (const citation of citationsIn(text)) {
        const a = from + citation.from;
        const b = from + citation.to;
        // The caret on it shows its Markdown, to edit or delete.
        if (sel.from <= b && sel.to >= a) continue;
        ranges.push(Decoration.replace({ widget: new CitationWidget(citation) }).range(a, b));
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
      const saved = this.shortening.reduce(
        (n, line) =>
          n +
          wordCount(
            applyCuts(
              line.text,
              line.cuts.filter((c) => !c.kept),
            ),
          ) -
          wordCount(line.text),
        0,
      );
      return {
        parts: [
          { strong: `${String(saved).replace("-", "−")} words` },
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
    // Only a list line can be an answer or a pen line: skip the rest cheaply.
    if (state.selection.main.empty && this.caretInNote() && isItem(caretLine)) {
      const lines = docLines(state);
      const i = caretIndex(state);
      const step = answerStep(lines, i);
      if (step && !itemText(lines[i]!)) return { parts: ANSWER };
      if (step) {
        return {
          parts: [
            { key: "↵" },
            { text: `check it against ${this.sourceLabel()}` },
            { gap: true },
            { key: "⇧↵" },
            { text: "another bullet" },
          ],
        };
      }
      const kind = penKindOf(lines[i]!);
      if (kind === "m") return { parts: [{ key: "↵" }, { text: "keep this one" }] };
      if (kind === "q" || kind === "a" || kind === "f" || kind === "r") {
        return { parts: [{ key: "↵" }, { text: "answer under it" }] };
      }
    }
    if (this.after && now < this.after.until) return { parts: this.after.parts };
    return this.caretInNote() ? { parts: REST, resting: true } : null;
  }

  /** The caret is in this note (the window itself may be in the back). */
  private caretInNote(): boolean {
    return this.view.contentDOM.contains(document.activeElement);
  }

  private sourceLabel(): string {
    const kind = sourceKind(this.getFilePath(), this.view.state.doc.toString());
    return kind ? SOURCE_LABEL[kind] : "the source";
  }

  private soFar(): string {
    const time = videoPlayerFor(this.getFilePath())?.time() ?? 0;
    return time > 0 ? ` (to ${formatVideoTime(time)})` : "";
  }

  private publish(): void {
    if (this.destroyed) return;
    setPenHint(this.getFilePath(), this.hint());
  }

  /* ------------------------------------------------------------ keys */

  arm(): void {
    if (this.shortening) return;
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
  private pills(): Array<{ key: string; label: string; title: string }> {
    const { state } = this.view;
    const lines = docLines(state);
    const quiz = sourceKind(this.getFilePath(), state.doc.toString()) !== null;
    const hasText = (this.armed ?? []).some((i) => itemText(lines[i]!));
    const inQuiz =
      quiz && penKindOf(lines[questionAbove(lines, caretIndex(state)) ?? -1] ?? "") === "q";
    const askMe = {
      key: "?",
      label: quiz ? "Quiz me" : "Ask me",
      title: "The AI asks you a question. What you type steers it.",
    };
    const answer = {
      key: "!",
      label: "Answer",
      title: "The AI answers what you type, or the line itself.",
    };
    if (!hasText) {
      return quiz
        ? [{ ...askMe, label: `Quiz me on everything so far${this.soFar()}` }, answer]
        : [answer];
    }
    return [
      askMe,
      answer,
      { key: "@", label: "Facts", title: "One fact from a recent paper, cited." },
      { key: "+", label: "Mix", title: "An unexpected link to another field." },
      { key: "−", label: "Shorten", title: "Proposes cuts. Nothing is added." },
      ...(inQuiz ? [{ key: "→", label: "New topic", title: "A question on another idea." }] : []),
    ];
  }

  /** The box: pills on top, the box to type in under them. */
  popView(): TooltipView {
    const dom = document.createElement("div");
    dom.className = "cm-pen-pop";
    dom.setAttribute("role", "dialog");
    dom.setAttribute("aria-label", "Second pen");
    const pills = document.createElement("div");
    pills.className = "cm-pen-pills";
    pills.setAttribute("role", "toolbar");
    const input = document.createElement("input");
    const choices = this.pills();
    for (const pill of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-pen-pill";
      button.dataset.penKey = pill.key;
      button.title = pill.title;
      const key = document.createElement("kbd");
      key.textContent = pill.key;
      button.append(key, document.createTextNode(pill.label));
      button.addEventListener("click", () => this.choose(pill.key, input.value));
      pills.append(button);
    }
    const field = document.createElement("div");
    field.className = "cm-pen-field";
    input.className = "cm-pen-input";
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.placeholder = "Ask a question, or give a direction";
    input.setAttribute("aria-label", "Ask the AI a question, or give it a direction");
    const keys = document.createElement("span");
    keys.className = "cm-pen-field-keys";
    keys.innerHTML = "<kbd>↵</kbd> ask AI <kbd>⌘↵</kbd> ask me";
    keys.hidden = true;
    input.addEventListener("input", () => {
      keys.hidden = !input.value.trim();
    });
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      const text = input.value.trim();
      const mod = event.metaKey || event.ctrlKey;
      let key: string | null = null;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closePop(true);
        return;
      }
      if (event.key === "Enter" && text) key = mod ? "?" : "!";
      else if (!text && !mod && !event.altKey) {
        // An empty box: the pills' own keys pick them, as they say.
        const pressed = keyAfterArm(event) === "-" ? "−" : keyAfterArm(event);
        const asKey = pressed === "ArrowRight" ? "→" : pressed;
        if (choices.some((c) => c.key === asKey)) key = asKey;
      }
      if (!key) return;
      event.preventDefault();
      event.stopPropagation();
      this.choose(key, input.value);
    });
    field.append(input, keys);
    dom.append(pills, field);
    // Clicking away closes it; moving between its own pills doesn't.
    dom.addEventListener("focusout", () => {
      setTimeout(() => {
        if (this.armed && !dom.contains(document.activeElement) && !this.view.hasFocus) {
          this.closePop(false);
        }
      }, 0);
    });
    return { dom, mount: () => input.focus() };
  }

  /** A pill, with what was typed: a direction, or for Answer the question. */
  private choose(key: string, typed: string): void {
    const text = typed.trim();
    this.closePop(true);
    switch (key) {
      case "?":
        void this.ask(false, text);
        break;
      case "→":
        void this.ask(true, text);
        break;
      case "!":
        void this.reply(text);
        break;
      case "@":
        void this.fact(text);
        break;
      case "+":
        void this.mix(text);
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
      this.endShorten(false);
      return true;
    }
    if (this.conversation) {
      this.conversation.cancel();
      this.conversation = null;
      this.placement = null;
      this.say("Stopped.");
      return true;
    }
    return this.takeBack();
  }

  /** Enter on a pen line or on an answer to a quiz question; false for a
   *  plain Enter. */
  enter(): boolean {
    const { state } = this.view;
    if (!state.selection.main.empty || this.shortening) return false;
    const lines = docLines(state);
    const i = caretIndex(state);
    const kind = penKindOf(lines[i]!);
    if (kind === "q" || kind === "a" || kind === "f" || kind === "m" || kind === "r") {
      this.answerUnder(i, kind === "m");
      return true;
    }
    const step = answerStep(lines, i);
    if (!step) return false;
    if (this.conversation) return true;
    void this.answer(i, step.question, step.step);
    return true;
  }

  clickCut(target: HTMLElement): boolean {
    const at = target.closest<HTMLElement>("[data-pen-cut]")?.dataset.penCut;
    if (!at || !this.shortening) return false;
    const [l, c] = at.split(":").map(Number);
    const cut = this.shortening[l!]?.cuts[c!];
    if (!cut) return false;
    cut.kept = !cut.kept;
    this.redraw();
    return true;
  }

  isShortening(): boolean {
    return this.shortening !== null;
  }

  endShorten(apply: boolean): void {
    const lines = this.shortening;
    if (!lines) return;
    this.shortening = null;
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
      effects: [setLock.of(false), refresh.of(null)],
      annotations: penEdit.of(true),
      userEvent: "input.pen",
    });
  }

  /* -------------------------------------------------------- requests */

  private start(label: string): PenConversation {
    this.conversation = penConversation();
    this.busyLabel = label;
    this.message = null;
    this.redraw();
    return this.conversation;
  }

  private finish(conversation: PenConversation): void {
    conversation.end();
    if (this.conversation === conversation) this.conversation = null;
    this.redraw();
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

  /** `?` (and `→`, a new topic): a quiz question in a source note, else a
   *  question about your thinking. */
  private async ask(newTopic: boolean, direction = ""): Promise<void> {
    const { state } = this.view;
    const lines = docLines(state);
    const path = this.getFilePath();
    const body = state.doc.toString();
    const quiz = sourceKind(path, body) !== null;
    const caret = caretIndex(state);
    const targets = targetIndexes(state).filter((i) => itemText(lines[i]!));
    const above = questionAbove(lines, caret);
    const continuing = above !== null && penKindOf(lines[above]!) === (quiz ? "q" : "a");
    if (newTopic && !quiz) {
      this.say("→ asks about a new topic in a quiz on a video or a book.");
      return;
    }

    // A thread's questions so far (follow-ups nest under your answers), so
    // one more never repeats one, and its note line, so it stays on topic.
    let root = above;
    while (continuing && root !== null) {
      const up = parentOf(lines, root);
      const higher = up >= 0 ? questionAbove(lines, up) : null;
      if (higher === null || penKindOf(lines[higher]!) !== penKindOf(lines[root]!)) break;
      root = higher;
    }
    const thread =
      continuing && root !== null
        ? lines
            .slice(root, subtreeEnd(lines, root) + 1)
            .map((_, k) => root + k)
            .filter((j) => penKindOf(lines[j]!) === penKindOf(lines[root]!))
            .map((j) => {
              const answers = childrenOf(lines, j)
                .filter((c) => !penKindOf(lines[c]!))
                .map((c) => itemText(lines[c]!))
                .filter(Boolean);
              return `${itemText(lines[j]!)}${answers.length ? ` (the writer answered: ${answers.join("; ")})` : ""}`;
            })
        : [];
    const threadNote = continuing && root !== null ? parentOf(lines, root) : -1;

    let placement: Placement;
    let anchor: number | null;
    let already: string[];
    let promptLines: number[];
    if (targets.length) {
      // Right under the line you're on: a sub-bullet, or a line below.
      anchor = targets[targets.length - 1]!;
      placement = { mode: "under", pos: state.doc.line(anchor + 1).from };
      already = continuing
        ? thread
        : childrenOf(lines, anchor)
            .filter((j) => penKindOf(lines[j]!) === (quiz ? "q" : "a"))
            .map((j) => itemText(lines[j]!));
      promptLines = [...(threadNote >= 0 ? [threadNote] : []), ...targets];
    } else if ((quiz || continuing) && isBlankLine(lines[caret]!)) {
      // An empty line becomes the question.
      anchor = continuing ? caret : null;
      placement = { mode: "slot", pos: state.doc.line(caret + 1).from };
      already = thread;
      promptLines = threadNote >= 0 ? [threadNote] : [];
    } else {
      this.say("Put the caret on a line, or select some, first.");
      return;
    }

    const conversation = this.start("Writing a question…");
    this.placement = placement;
    try {
      const { source, focus } = quiz
        ? await readSource(path, body, lines, anchor)
        : { source: null, focus: null };
      if (source && !source.passages.length && source.kind === "video") {
        this.placement = null;
        this.finish(conversation);
        this.say("Nothing watched yet to quiz you on. Play the video, then ask again.");
        return;
      }
      const ask: PenAsk = quiz
        ? { task: "quiz", already, newTopic, focus }
        : { task: "ask", already };
      const reply = await conversation.send(
        penPrompt({ ...this.promptBase(lines, promptLines, direction), source, ask }),
      );
      const text = replyLine(reply);
      if (!text) {
        this.placement = null;
        this.finish(conversation);
        this.say(
          quiz && !anchor
            ? (this.doneLine() ?? "That's all I have. The rest is yours.")
            : "That's all I have on this line. The rest is yours.",
        );
        return;
      }
      this.write(quiz ? "q" : "a", text, quiz ? "child" : null);
      this.finish(conversation);
      this.sayAfter([
        { key: "⌘ ." },
        { key: "?" },
        { text: "one more" },
        ...(quiz
          ? ([{ gap: true }, { key: "⌘ ." }, { key: "→" }, { text: "new topic" }] as PenHintPart[])
          : []),
      ]);
    } catch (error) {
      this.fail(conversation, error);
    }
  }

  private doneLine(): string | null {
    const time = videoPlayerFor(this.getFilePath())?.time() ?? 0;
    return time > 0
      ? `That's everything up to ${formatVideoTime(time)}. Watch on, then quiz again.`
      : null;
  }

  /** `@`: one fact from the newest well-cited paper on the line, cited. */
  private async fact(direction = ""): Promise<void> {
    const { state } = this.view;
    const lines = docLines(state);
    const targets = targetIndexes(state).filter((i) => itemText(lines[i]!));
    if (!targets.length) {
      this.say("Put the caret on a line, or select some, first.");
      return;
    }
    const anchor = targets[targets.length - 1]!;
    const conversation = this.start("Finding a paper…");
    this.placement = { mode: "under", pos: state.doc.line(anchor + 1).from };
    try {
      const base = { ...this.promptBase(lines, targets, direction), source: null };
      // One more never cites the same paper or says the same thing again.
      const given = childrenOf(lines, anchor).filter((j) => penKindOf(lines[j]!) === "f");
      const cited = new Set(given.flatMap((j) => citationsIn(lines[j]!).map((c) => c.url)));
      const already = given.map((j) => itemText(lines[j]!));
      let found: ReturnType<typeof factReply> = null;
      let searched = false;
      // A query that finds nothing usable gets one broader try.
      for (const ask of [{ task: "factQuery" }, { task: "factRetry" }] as const) {
        const query = replyLine(await conversation.send(penPrompt({ ...base, ask })));
        const papers = query
          ? (await searchPapers(query)).filter((paper) => !cited.has(paper.url))
          : [];
        if (!papers.length) continue;
        searched = true;
        this.busyLabel = "Reading the paper…";
        this.redraw();
        found = factReply(
          await conversation.send(
            penPrompt({ ...base, ask: { task: "factWrite", papers, already } }),
          ),
          papers,
        );
        if (found) break;
      }
      if (!found) {
        this.placement = null;
        this.finish(conversation);
        this.say(searched ? "No fact here I'd stand behind." : "No paper found for this line.");
        return;
      }
      const id = this.write("f", `${found.fact} ${citationMarkdown(found.paper)}`);
      this.batch = id ? [...this.batch, id] : this.batch;
      this.finish(conversation);
      this.sayAfter([
        { key: "⌘ ." },
        { key: "@" },
        { text: "one more" },
        { gap: true },
        { key: "Esc" },
        { text: "take it back" },
      ]);
    } catch (error) {
      this.fail(conversation, error);
    }
  }

  /** `!`: you ask, the pen answers. What you typed in the box is your
   *  question: it goes into the note under the line you're on (or on the
   *  empty line), and the answer under it. With nothing typed, the line itself
   *  is the question. Again on the same line for one more that goes further. */
  private async reply(question = ""): Promise<void> {
    const { state } = this.view;
    const lines = docLines(state);
    const path = this.getFilePath();
    const targets = targetIndexes(state).filter((i) => itemText(lines[i]!));
    if (!question && !targets.length) {
      this.say("Type your question in the box, or put the caret on it.");
      return;
    }
    let anchorPos: number;
    let already: string[] = [];
    if (question) {
      const caret = caretIndex(state);
      const placement: Placement = targets.length
        ? { mode: "under", pos: state.doc.line(targets[targets.length - 1]! + 1).from }
        : { mode: "slot", pos: state.doc.line(caret + 1).from };
      anchorPos = this.writeLine(null, question, placement).lineFrom;
    } else {
      const anchor = targets[targets.length - 1]!;
      anchorPos = state.doc.line(anchor + 1).from;
      already = childrenOf(lines, anchor)
        .filter((j) => penKindOf(lines[j]!) === "r")
        .map((j) => itemText(lines[j]!));
    }
    const conversation = this.start("Answering…");
    this.placement = { mode: "under", pos: anchorPos };
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
      const id = this.write("r", text);
      this.batch = id ? [...this.batch, id] : this.batch;
      this.finish(conversation);
      this.sayAfter([
        { key: "⌘ ." },
        { key: "!" },
        { text: "say more" },
        { gap: true },
        { key: "↵" },
        { text: "reply under it" },
        { gap: true },
        { key: "Esc" },
        { text: "take it back" },
      ]);
    } catch (error) {
      this.fail(conversation, error);
    }
  }

  /** `+`: one unexpected mix. Enter on one keeps it and drops the others. */
  private async mix(direction = ""): Promise<void> {
    const { state } = this.view;
    const lines = docLines(state);
    const targets = targetIndexes(state).filter((i) => itemText(lines[i]!));
    if (!targets.length) {
      this.say("Put the caret on a line, or select some, first.");
      return;
    }
    const anchor = targets[targets.length - 1]!;
    const already = childrenOf(lines, anchor)
      .filter((j) => penKindOf(lines[j]!) === "m")
      .map((j) => itemText(lines[j]!));
    const conversation = this.start("Writing a mix…");
    this.placement = { mode: "under", pos: state.doc.line(anchor + 1).from };
    try {
      const reply = await conversation.send(
        penPrompt({
          ...this.promptBase(lines, targets, direction),
          source: null,
          ask: { task: "mix", already },
        }),
      );
      const text = replyLine(reply);
      if (!text) {
        this.placement = null;
        this.finish(conversation);
        this.say("That's all I have on this line. The rest is yours.");
        return;
      }
      const id = this.write("m", text);
      this.batch = id ? [...this.batch, id] : this.batch;
      this.finish(conversation);
      this.sayAfter([
        { key: "⌘ ." },
        { key: "+" },
        { text: "one more" },
        { gap: true },
        { key: "↵" },
        { text: "on one keeps it" },
        { gap: true },
        { key: "Esc" },
        { text: "take it back" },
      ]);
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
    const conversation = this.start("Finding words to cut…");
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

  /** Enter on your answer to a quiz question: the hint, or the check. */
  private async answer(i: number, question: number, step: "check" | "hint"): Promise<void> {
    const { state } = this.view;
    const lines = docLines(state);
    const path = this.getFilePath();
    const line = state.doc.line(i + 1);
    let answerPos = line.from;
    if (!itemText(lines[i]!)) {
      // An empty answer is a real one: you didn't know.
      const at = line.from + bodyStart(line.text);
      const gap = /\s$/.test(line.text.slice(0, at - line.from)) ? "" : " ";
      this.view.dispatch({
        changes: {
          from: at,
          to: Math.max(at, line.from + bodyEnd(line.text)),
          insert: `${gap}I don't know`,
        },
        annotations: penEdit.of(true),
        userEvent: "input.pen",
      });
      lines[i] = this.view.state.doc.line(i + 1).text;
      answerPos = this.view.state.doc.line(i + 1).from;
    }
    const questionText = itemText(lines[question]!);
    const answers = childrenOf(lines, question)
      .filter((c) => !penKindOf(lines[c]!))
      .map((c) => itemText(lines[c]!))
      .filter(Boolean);
    const conversation = this.start(step === "hint" ? "Writing a hint…" : "Checking your answer…");
    // The hint or check goes under your answer.
    this.placement = { mode: "under", pos: answerPos };
    try {
      const { source } = await readSource(path, this.view.state.doc.toString(), lines, question);
      const ask: PenAsk =
        step === "hint"
          ? { task: "hint", question: questionText, answers }
          : { task: "check", question: questionText, answers };
      const reply = await conversation.send(
        penPrompt({ ...this.promptBase(lines, [question]), source, ask }),
      );
      const text = replyLine(reply, true);
      if (!text) {
        this.placement = null;
        this.finish(conversation);
        this.say(
          step === "hint"
            ? "No hint I'd stand behind."
            : `${this.sourceLabel()} doesn't answer this one.`,
        );
        return;
      }
      // After a hint, the next answer goes beside the one it hangs under.
      this.write(
        step === "hint" ? "h" : "c",
        step === "hint" ? `Hint: ${text}` : text,
        step === "hint" ? "next" : null,
      );
      this.finish(conversation);
      if (step === "check") {
        this.sayAfter([
          { key: "⌘ ." },
          { key: "?" },
          { text: "one more" },
          { gap: true },
          { key: "⌘ ." },
          { key: "→" },
          { text: "new topic" },
        ]);
      }
    } catch (error) {
      this.fail(conversation, error);
    }
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
      if (id) this.slotQuestions.add(id);
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

  /** Enter on a pen line: an answer bullet under it, after its answers. On a
   *  mix, the unanswered mixes beside it go. */
  private answerUnder(i: number, keepMix: boolean): void {
    const { state } = this.view;
    const lines = docLines(state);
    const end = state.doc.line(subtreeEnd(lines, i) + 1).to;
    const insert = `\n${childIndent(lines[i]!)}- `;
    const changes: ChangeSpec[] = [{ from: end, insert }];
    if (keepMix) {
      for (const j of unansweredSiblingMixes(lines, i)) changes.push(lineRange(state, j, j));
    }
    const set = state.changes(changes);
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
      if (parentKind === "q" || parentKind === "a") {
        const prev = i - 1;
        // The hint hangs under the answer before this one.
        if (penKindOf(lines[prev]!) === "h" && parentOf(lines, parentOf(lines, prev)) === parent) {
          this.removeLines(prev, i, null);
          return true;
        }
        if (childrenOf(lines, parent).length === 1) {
          const id = /\^(ai-[a-z]-[a-z0-9]{4})\s*$/.exec(lines[parent]!)?.[1];
          // A question that took an empty bullet's place gives it back; a
          // plain one leaves the blank line it came from.
          const restore =
            id && this.slotQuestions.has(id) && isItem(lines[parent]!)
              ? `${/^\s*/.exec(lines[parent]!)![0]}- `
              : null;
          if (id) this.slotQuestions.delete(id);
          this.removeLines(parent, i, restore);
          return true;
        }
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

function keyAfterArm(event: KeyboardEvent): string {
  if (event.key === "/" && event.shiftKey) return "?";
  if (event.key === "2" && event.shiftKey) return "@";
  if (event.key === "=" && event.shiftKey) return "+";
  if (event.key === "1" && event.shiftKey) return "!";
  return event.key;
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
          if (pen.isShortening()) {
            if (event.key === "Enter") pen.endShorten(true);
            else if (event.key === "Escape") pen.endShorten(false);
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
          if (event.key === "Enter" && !event.shiftKey && !mod && !event.altKey && pen.enter()) {
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
  return [lockField, lockFilter, popField, Prec.highest(plugin), citationCard];
}
