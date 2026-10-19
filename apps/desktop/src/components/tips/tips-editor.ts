import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import * as editorApi from "@/hooks/editor-api";
import { getWorkspaceFileCount } from "@/hooks/workspace-api";
import { podcastLinkOf } from "@/lib/podcast-player";
import { formatVideoTime, isBlankLine, videoIdOf } from "@/lib/video-pins";
import { videoPlayerFor } from "@/lib/video-players";
import { arriveAt, leaveAnchor, noteTipLine, useTipsStore, type ActiveTip } from "./tips-store";
import { tipById, type NoteKind, type TipArrival } from "./tips";
import "./tips.css";

// A tip's line in a note (SPECs/in-context-tips-spec.md): a decoration the
// shape of the pen's "Your take first…", never written to the file. The
// plugin reports the editor's moments (a note opening, the caret leaving a
// line, several lines selected) and tests the lines a change touched for a
// tip's trace (`^yt-`, `^bk-`, `^ai-…`). It does nothing else per keystroke.

/** Where the line goes: on an empty line, as its placeholder, or after the
 *  line it is about. */
type Place = "on" | "after";

interface TipMark {
  pos: number;
  place: Place;
  text: string;
  phase: ActiveTip["phase"];
  /** A placeholder hides once its line has words. */
  hidden: boolean;
}

const setTipMark = StateEffect.define<TipMark | null>();

/** A placeholder's line got words: the hint hides (the pill stays), and the
 *  done line goes after them. */
function settle(state: EditorState, mark: TipMark): TipMark {
  const blank = isBlankLine(state.doc.lineAt(mark.pos).text);
  if (mark.phase === "ask") return { ...mark, hidden: mark.place === "on" && !blank };
  return { ...mark, hidden: false, place: mark.place === "on" && !blank ? "after" : mark.place };
}

const tipMarkField = StateField.define<TipMark | null>({
  create: () => null,
  update(mark, tr) {
    for (const effect of tr.effects) if (effect.is(setTipMark)) mark = effect.value;
    if (!mark || !tr.docChanged) return mark;
    const pos = tr.changes.mapPos(mark.pos, 1);
    const at = tr.state.doc.lineAt(pos);
    // Stay at the end of the line it was on.
    return settle(tr.state, { ...mark, pos: at.to });
  },
  provide: (field) =>
    EditorView.decorations.from(field, (mark): DecorationSet => {
      if (!mark || mark.hidden) return Decoration.none;
      return Decoration.set([
        Decoration.widget({
          widget: new TipWidget(mark.text, mark.place, mark.phase),
          side: 1,
        }).range(mark.pos),
      ]);
    }),
});

class TipWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly place: Place,
    readonly phase: ActiveTip["phase"],
  ) {
    super();
  }

  eq(other: TipWidget): boolean {
    return other.text === this.text && other.place === this.place && other.phase === this.phase;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-tip";
    span.dataset.place = this.place;
    span.dataset.phase = this.phase;
    span.setAttribute("role", "status");
    span.textContent = this.text;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** What the note at `path` is, from its frontmatter. A book's note says
 *  so when its reader opens (useBookTips). */
function noteKind(path: string): NoteKind {
  const frontmatter = editorApi.getOpenFile(path)?.frontmatter ?? null;
  if (videoIdOf(frontmatter)) return "youtube";
  if (podcastLinkOf(frontmatter)) return "podcast";
  return "note";
}

/** Where an opened note's tip writes: the empty bullet under the player for
 *  a video or episode, else the note's empty last line; after the last line
 *  when there is none. */
function openPlace(state: EditorState, kind: NoteKind): Pick<TipMark, "pos" | "place"> {
  const doc = state.doc;
  if (kind === "youtube" || kind === "podcast") {
    for (let n = 1; n <= doc.lines; n += 1) {
      const line = doc.line(n);
      if (/^\s*[-*+]\s*$/.test(line.text)) return { pos: line.to, place: "on" };
      if (/^\s*[-*+]\s+\S/.test(line.text)) break;
    }
  }
  const last = doc.line(doc.lines);
  return { pos: last.to, place: isBlankLine(last.text) ? "on" : "after" };
}

/** The mark for the tip showing now, if it belongs in this note. */
function markFor(state: EditorState, path: string, active: ActiveTip | null): TipMark | null {
  if (!active || active.arrival.anchor !== "editor" || active.arrival.path !== path) return null;
  const tip = tipById(active.id);
  if (!tip) return null;
  const arrival = active.arrival;
  let at: Pick<TipMark, "pos" | "place">;
  if (arrival.moment === "open") {
    at = openPlace(state, arrival.kind);
  } else {
    if (arrival.line >= state.doc.lines) return null;
    at = { pos: state.doc.line(arrival.line + 1).to, place: "after" };
  }
  let text = tip.line;
  if (active.phase !== "ask") {
    const player = videoPlayerFor(path);
    text = tip.did({
      playing: player?.playing() ?? false,
      time: formatVideoTime(player?.time() ?? 0),
    });
  }
  return settle(state, { ...at, text, phase: active.phase, hidden: false });
}

/** How many changed lines one change may have tested for traces: a paste of
 *  a whole note is not a move a tip waits for. */
const TRACE_LINES_MAX = 40;

const isSwap = (update: ViewUpdate) => update.transactions.some((tr) => tr.isUserEvent("pensee"));

class TipsPlugin {
  private path: string;
  /** The start of the caret's line, mapped through changes. */
  private caretLine: number;
  private selectedLines = 1;
  /** The tip the mark drawn now belongs to. */
  private markId: string | null = null;
  private readonly unsubscribe: () => void;
  private destroyed = false;

  constructor(
    private readonly view: EditorView,
    private readonly getFilePath: () => string,
  ) {
    this.path = getFilePath();
    this.caretLine = view.state.doc.lineAt(view.state.selection.main.head).from;
    this.unsubscribe = useTipsStore.subscribe((state, prev) => {
      if (state.active !== prev.active) this.sync(state.active);
    });
    this.later(() => {
      this.sync(useTipsStore.getState().active);
      this.arriveOpen();
    });
  }

  update(update: ViewUpdate): void {
    const { state } = update;
    if (isSwap(update)) {
      const was = this.path;
      this.path = this.getFilePath();
      if (was !== this.path) {
        leaveAnchor("editor", (a) => a.anchor === "editor" && a.path === was);
        this.later(() => {
          this.sync(useTipsStore.getState().active);
          this.arriveOpen();
        });
      }
      this.caretLine = state.doc.lineAt(state.selection.main.head).from;
      return;
    }
    if (update.docChanged) {
      this.testTraces(update);
      this.caretLine = update.changes.mapPos(this.caretLine, -1);
    }
    if (!update.selectionSet || !update.view.hasFocus) return;
    const main = state.selection.main;
    const line = state.doc.lineAt(main.head);
    if (line.from !== this.caretLine && main.empty) {
      const left = this.caretLine <= state.doc.length ? state.doc.lineAt(this.caretLine) : null;
      if (left && left.number !== line.number) {
        this.arrive({
          anchor: "editor",
          moment: "leave-line",
          path: this.path,
          kind: noteKind(this.path),
          line: left.number - 1,
          text: left.text,
          vaultNotes: getWorkspaceFileCount(),
        });
      }
    }
    this.caretLine = line.from;
    const lines = main.empty
      ? 1
      : state.doc.lineAt(main.to).number - state.doc.lineAt(main.from).number + 1;
    if (lines >= 3 && this.selectedLines < 3) {
      this.arrive({
        anchor: "editor",
        moment: "select",
        path: this.path,
        line: state.doc.lineAt(main.to).number - 1,
        lines,
      });
    }
    this.selectedLines = lines;
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    const path = this.path;
    leaveAnchor("editor", (a) => a.anchor === "editor" && a.path === path);
  }

  /** The lines a change touched, tested for traces only when they hold a
   *  `^` (one `includes` per changed line otherwise). */
  private testTraces(update: ViewUpdate): void {
    const doc = update.state.doc;
    let budget = TRACE_LINES_MAX;
    update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      if (budget <= 0) return;
      const first = doc.lineAt(fromB).number;
      const last = doc.lineAt(toB).number;
      for (let n = first; n <= last && budget > 0; n += 1, budget -= 1) {
        const text = doc.line(n).text;
        if (text.includes("^")) noteTipLine(text);
      }
    });
  }

  private arriveOpen(): void {
    const kind = noteKind(this.path);
    if (kind !== "note") arriveAt({ anchor: "editor", moment: "open", path: this.path, kind });
  }

  /** Arrivals and store changes can land inside this view's own update (a
   *  trace finishing a tip): the dispatch waits for it to end. */
  private arrive(arrival: TipArrival): void {
    this.later(() => arriveAt(arrival));
  }

  private sync(active: ActiveTip | null): void {
    this.later(() => {
      let mark = markFor(this.view.state, this.path, active);
      const current = this.view.state.field(tipMarkField, false) ?? null;
      if (!mark && !current) return;
      // The same tip moving on to its done line stays where it was drawn.
      if (mark && current && active?.id === this.markId) {
        mark = settle(this.view.state, { ...mark, pos: current.pos, place: current.place });
      }
      this.markId = mark ? (active?.id ?? null) : null;
      this.view.dispatch({ effects: setTipMark.of(mark) });
    });
  }

  private later(run: () => void): void {
    queueMicrotask(() => {
      if (!this.destroyed) run();
    });
  }
}

/** The tips' editor half: the moments, the trace test, the line. */
export function tipsEditor(getFilePath: () => string): Extension {
  return [tipMarkField, ViewPlugin.define((view) => new TipsPlugin(view, getFilePath))];
}
