import { describe, expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { headingDecorations } from "../src/components/editor-area/heading-decorations";
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

describe("with the real heading guard", () => {
  // The guard parks a pointer end that lands in `## ` after it. Whichever
  // filter runs first, the paragraph selection must still end on its period.
  const cases = [
    ["blank line before the heading", "Love how he tried.\n\n## Key message"],
    ["heading right after", "Love how he tried.\n## Key message"],
  ] as const;
  for (const [name, doc] of cases) {
    for (const order of ["guard registered first", "guard registered last"] as const) {
      test(`${name}, ${order}`, () => {
        const exts =
          order === "guard registered first"
            ? [markdown(), headingDecorations, paragraphSelection]
            : [markdown(), paragraphSelection, headingDecorations];
        const state = EditorState.create({ doc, extensions: exts });
        const end = doc.indexOf(".") + 1;
        const headingStart = doc.indexOf("##");
        const sel = state.update({
          selection: EditorSelection.single(0, headingStart),
          userEvent: "select.pointer",
        }).state.selection.main;
        expect([sel.from, sel.to]).toEqual([0, end]);
      });
    }
  }
});
