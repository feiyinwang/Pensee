import { describe, expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  paragraphMarkPositions,
  paragraphSelection,
} from "../src/components/editor-area/paragraph-selection";

const DOC = "# Skip\n\nLove how he tried.\n\n## Key message";
const PARA_FROM = DOC.indexOf("Love");
const PARA_TO = DOC.indexOf(".\n") + 1;

function select(anchor: number, head: number, userEvent: string) {
  const state = EditorState.create({ doc: DOC, extensions: [paragraphSelection] });
  return state.update({ selection: EditorSelection.single(anchor, head), userEvent }).state
    .selection.main;
}

describe("pointer selections stop at the paragraph's end", () => {
  test("a line click through the newline ends on the last character", () => {
    const sel = select(PARA_FROM, PARA_TO + 1, "select.pointer");
    expect([sel.from, sel.to]).toEqual([PARA_FROM, PARA_TO]);
  });

  test("a drag past the paragraph into the gap is pulled back", () => {
    const sel = select(PARA_FROM + 5, PARA_TO + 2, "select.pointer");
    expect([sel.anchor, sel.head]).toEqual([PARA_FROM + 5, PARA_TO]);
  });

  test("a backwards drag keeps its direction", () => {
    const sel = select(PARA_TO + 1, PARA_FROM, "select.pointer");
    expect([sel.anchor, sel.head]).toEqual([PARA_TO, PARA_FROM]);
  });

  test("a click on a blank line keeps its newline", () => {
    const blank = PARA_TO + 1;
    const sel = select(blank, blank + 1, "select.pointer");
    expect([sel.from, sel.to]).toEqual([blank, blank + 1]);
  });

  test("keyboard selections are left alone", () => {
    const sel = select(PARA_FROM, PARA_TO + 1, "select");
    expect(sel.to).toBe(PARA_TO + 1);
  });
});

describe("¶ placement", () => {
  const doc = EditorState.create({ doc: DOC }).doc;

  test("a whole selected paragraph gets a ¶ at its end", () => {
    expect(paragraphMarkPositions(doc, [EditorSelection.range(PARA_FROM, PARA_TO)])).toEqual([
      PARA_TO,
    ]);
  });

  test("a word at the paragraph's end gets none", () => {
    expect(paragraphMarkPositions(doc, [EditorSelection.range(PARA_TO - 6, PARA_TO)])).toEqual([]);
  });

  test("a caret gets none", () => {
    expect(paragraphMarkPositions(doc, [EditorSelection.cursor(PARA_TO)])).toEqual([]);
  });
});
