import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import "./callout-decorations.css";

// Obsidian callouts (SPECs/talk-notes-spec.md#the-note-after-a-stop): a
// blockquote whose first line is `> [!type]` gets a header and a box. With
// `-` (`> [!transcript]- …`) it starts folded: only the header shows until you
// press its chevron or put the caret in it. Folding is a view state, as in
// Obsidian: the file keeps its `-`.
//
// A StateField, not a view plugin: hiding the body is a block replace, which
// CodeMirror accepts only from state.

const HEAD_RE = /^(\s*>\s*)\[!([\w-]+)\]([+-]?)\s?/;

export interface Callout {
  /** The header line's start. */
  from: number;
  /** The end of the callout's last line. */
  to: number;
  type: string;
  /** Where the `[!type]-` marker sits on the header line. */
  markerFrom: number;
  markerTo: number;
  foldedByDefault: boolean;
  /** The first body line's start, or null for a header-only callout. */
  bodyFrom: number | null;
}

/** Every callout in the parsed document. */
export function findCallouts(state: EditorState): Callout[] {
  const out: Callout[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Blockquote") return;
      const head = state.doc.lineAt(node.from);
      const m = HEAD_RE.exec(head.text);
      if (m) {
        const last = state.doc.lineAt(node.to);
        out.push({
          from: head.from,
          to: last.to,
          type: m[2]!.toLowerCase(),
          markerFrom: head.from + m[1]!.length,
          markerTo: head.from + m[0].length,
          foldedByDefault: m[3] === "-",
          bodyFrom: last.number > head.number ? state.doc.line(head.number + 1).from : null,
        });
      }
      return false;
    },
  });
  return out;
}

/** Flips one callout open or shut; carries its header position. */
const toggleCallout = StateEffect.define<number>({ map: (pos, change) => change.mapPos(pos) });

/** Header positions the user flipped away from the callout's default. */
const flipped = StateField.define<Set<number>>({
  create: () => new Set(),
  update(value, tr) {
    let next = value;
    if (tr.docChanged) next = new Set([...value].map((p) => tr.changes.mapPos(p)));
    for (const e of tr.effects) {
      if (!e.is(toggleCallout)) continue;
      next = new Set(next);
      if (next.has(e.value)) next.delete(e.value);
      else next.add(e.value);
    }
    return next;
  },
});

class CalloutChevron extends WidgetType {
  constructor(
    readonly head: number,
    readonly open: boolean,
    readonly type: string,
  ) {
    super();
  }

  eq(other: CalloutChevron): boolean {
    return other.head === this.head && other.open === this.open && other.type === this.type;
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-callout-chevron";
    button.setAttribute("aria-expanded", String(this.open));
    button.setAttribute("aria-label", this.open ? "Fold" : "Unfold");
    button.dataset.type = this.type;
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", (e) => {
      e.preventDefault();
      view.dispatch({ effects: toggleCallout.of(this.head) });
    });
    return button;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function build(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const turned = state.field(flipped);
  const { ranges } = state.selection;
  for (const c of findCallouts(state)) {
    const caretIn = ranges.some((r) => r.to >= c.from && r.from <= c.to);
    const caretOnHead = ranges.some((r) => r.to >= c.from && r.from <= c.markerTo);
    const open = c.bodyFrom === null || caretIn || c.foldedByDefault === turned.has(c.from);
    decos.push(
      Decoration.line({ attributes: { class: "cm-callout-head", "data-callout": c.type } }).range(
        c.from,
      ),
    );
    if (!caretOnHead) {
      decos.push(
        Decoration.replace({ widget: new CalloutChevron(c.from, open, c.type) }).range(
          c.markerFrom,
          c.markerTo,
        ),
      );
    }
    if (c.bodyFrom === null) continue;
    if (open) {
      for (let pos = c.bodyFrom; pos <= c.to; ) {
        const line = state.doc.lineAt(pos);
        decos.push(
          Decoration.line({
            attributes: { class: "cm-callout-line", "data-callout": c.type },
          }).range(line.from),
        );
        pos = line.to + 1;
      }
    } else {
      // The newline before the body goes too, so nothing is left of it.
      decos.push(Decoration.replace({ block: true }).range(c.bodyFrom - 1, c.to));
    }
  }
  return RangeSet.of(decos, true);
}

const calloutField = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update(value, tr) {
    const parsed = syntaxTree(tr.state) !== syntaxTree(tr.startState);
    const toggled = tr.effects.some((e) => e.is(toggleCallout));
    if (tr.docChanged || tr.selection || parsed || toggled) return build(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const calloutDecorations = () => [flipped, calloutField];
