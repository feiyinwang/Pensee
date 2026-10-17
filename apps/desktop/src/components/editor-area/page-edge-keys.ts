import { EditorSelection, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { findOuterScroller } from "./editor-scroll";

const toEdge = StateEffect.define<"top" | "bottom">();

// Which edge the latest transaction went to, if it was ⌘↑ / ⌘↓; any other
// caret move or edit clears it, so the scroll handler only takes those over.
const edgeIntent = StateField.define<"top" | "bottom" | null>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(toEdge)) return effect.value;
    return tr.selection || tr.docChanged ? null : value;
  },
});

/** Caret to the body's start or end (⇧ extends the selection), then the page
 *  scrolls all the way there. CodeMirror's own ⌘↑ / ⌘↓ only scroll the caret
 *  into view, which leaves the title and properties above the body hidden and
 *  stops short of the page's bottom padding. */
function toPageEdge(view: EditorView, forward: boolean, extend: boolean): boolean {
  const { state } = view;
  const pos = forward ? state.doc.length : 0;
  view.dispatch({
    selection: extend
      ? EditorSelection.range(state.selection.main.anchor, pos)
      : EditorSelection.cursor(pos),
    effects: toEdge.of(forward ? "bottom" : "top"),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

// CodeMirror calls this once the caret's lines are drawn and measured, so a
// long note's bottom is where it will stay, not a height guess. The real
// scroller is the outer `EditorScrollContainer` (docs/editor.md), scrolled
// to its very edge instead of just far enough to show the caret.
const edgeScrollHandler = EditorView.scrollHandler.of((view, range) => {
  const edge = view.state.field(edgeIntent, false);
  if (!edge) return false;
  // By line, not position: a note that opens with a heading clamps the caret
  // past its hidden `#` (heading-decorations.ts).
  const { doc } = view.state;
  if (doc.lineAt(range.head).number !== (edge === "bottom" ? doc.lines : 1)) return false;
  const scroller = findOuterScroller(view.dom);
  if (!scroller) return false;
  const top = edge === "bottom" ? scroller.scrollHeight - scroller.clientHeight : 0;
  scroller.scrollTo({ top, behavior: "auto" });
  return true;
});

/** ⌘↑ / ⌘↓ (Ctrl+Home / Ctrl+End elsewhere): the top or bottom of the page. */
export const pageEdgeKeys = [
  edgeIntent,
  edgeScrollHandler,
  Prec.high(
    keymap.of([
      {
        key: "Mod-Home",
        mac: "Cmd-ArrowUp",
        run: (view) => toPageEdge(view, false, false),
        shift: (view) => toPageEdge(view, false, true),
        preventDefault: true,
      },
      {
        key: "Mod-End",
        mac: "Cmd-ArrowDown",
        run: (view) => toPageEdge(view, true, false),
        shift: (view) => toPageEdge(view, true, true),
        preventDefault: true,
      },
    ]),
  ),
];
