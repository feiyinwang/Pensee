import {
  EditorSelection,
  EditorState,
  type Extension,
  type Line,
  type SelectionRange,
  type Text,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/**
 * Selecting a paragraph with the mouse, Ulysses-style.
 *
 * CodeMirror's line click selects *through* the trailing newline, so the
 * selection ends at the start of the blank line below and `drawSelection`
 * floods the rest of the last line plus the whole gap down to the next
 * heading. A drag that runs past the paragraph does the same.
 *
 * Pointer selections therefore stop at the last character of the paragraph
 * (and start past a bullet, number or `## `, never on the indent left of it),
 * and a ¶ (the brand mark the gutter chip uses) is drawn there to say "this
 * paragraph, to its end". Keyboard selections are left as typed: Shift+Down
 * over a line break is a deliberate choice.
 */

/** Hidden markup a line can open with: indentation, heading hashes, list
 *  and task markers, quotes. Each needs its space (or the line end) so a
 *  `#tag` or a `-dash` at the start of a line is still text. */
const LINE_PREFIX =
  /^\s*(?:#{1,6}(?:\s+|$)|[-*+](?:\s+|$)(?:\[[ xX]\](?:\s+|$))?|\d+[.)](?:\s+|$)|>\s*)*/;

/** Where a line's text starts, past its hidden prefix. */
function bodyFrom(line: Line): number {
  return line.from + (LINE_PREFIX.exec(line.text)?.[0].length ?? 0);
}

/** Fit a pointer range to the text it covers:
 *  - It starts where the first line's text starts — past a bullet, a number,
 *    `## ` or `> `, never on the indent left of them.
 *  - It ends on the last character of a line instead of the start of the
 *    (blank) one after. An end inside the next line's hidden prefix counts as
 *    that line's start: the heading guard parks it after `## `, and depending
 *    on filter order this runs before or after that.
 *  - A range wholly inside one line's prefix (a double-click on the bullet)
 *    becomes that line's text.
 *  Never collapses a range: a click on a blank line keeps its newline. */
export function fitPointerRange(doc: Text, range: SelectionRange): SelectionRange {
  if (range.empty) return range;
  let from = range.from;
  let to = range.to;
  const first = doc.lineAt(from);
  const body = bodyFrom(first);
  if (to <= body && first.to > body) {
    from = body;
    to = first.to;
  } else {
    if (from < body) from = body;
    const last = doc.lineAt(to);
    if (last.from > from && to <= bodyFrom(last)) to = last.from;
    while (to - 1 > from && doc.sliceString(to - 1, to) === "\n") to--;
  }
  if (from === range.from && to === range.to) return range;
  return range.head > range.anchor
    ? EditorSelection.range(from, to)
    : EditorSelection.range(to, from);
}

const trimPointerSelection = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || !tr.isUserEvent("select.pointer")) return tr;
  const sel = tr.newSelection;
  const doc = tr.newDoc;
  let changed = false;
  const ranges = sel.ranges.map((r) => {
    const next = fitPointerRange(doc, r);
    if (next !== r) changed = true;
    return next;
  });
  if (!changed) return tr;
  return [tr, { selection: EditorSelection.create(ranges, sel.mainIndex) }];
});

/** Where a ¶ goes: the end of every non-empty line a selection covers whole
 *  through its end. A word picked at a paragraph's end gets none — only a
 *  range that starts at or before the line's text (past any bullet) does. */
export function paragraphMarkPositions(doc: Text, ranges: readonly SelectionRange[]): number[] {
  const out: number[] = [];
  for (const r of ranges) {
    if (r.empty) continue;
    const line = doc.lineAt(r.to);
    if (r.to === line.to && line.length > 0 && r.from <= bodyFrom(line)) out.push(line.to);
  }
  return out;
}

class ParagraphMarkWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-paragraph-mark";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const mark = Decoration.widget({ widget: new ParagraphMarkWidget(), side: 1 });

function marksFor(state: EditorState): DecorationSet {
  const positions = paragraphMarkPositions(state.doc, state.selection.ranges);
  if (positions.length === 0) return Decoration.none;
  return Decoration.set(
    positions.map((pos) => mark.range(pos)),
    true,
  );
}

const paragraphMarks = EditorView.decorations.compute(["selection", "doc"], marksFor);

export const paragraphSelection: Extension = [trimPointerSelection, paragraphMarks];
