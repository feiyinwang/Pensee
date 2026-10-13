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

describe("bullets: from the bullet's text to its end", () => {
  const doc = "Intro\n\n- first item\n  - nested item\n- [ ] a task\n\n1. numbered";
  const sel = (anchor: number, head: number) => {
    const state = EditorState.create({ doc, extensions: [paragraphSelection] });
    return state.update({
      selection: EditorSelection.single(anchor, head),
      userEvent: "select.pointer",
    }).state.selection.main;
  };
  const text = (r: { from: number; to: number }) => doc.slice(r.from, r.to);
  const lineStart = (s: string) => doc.indexOf(s);
  const lineEnd = (s: string) => doc.indexOf(s) + s.length;

  test("a line click skips the marker and the newline", () => {
    expect(text(sel(lineStart("- first"), lineEnd("- first item") + 1))).toBe("first item");
  });

  test("a nested item skips its indent too", () => {
    expect(text(sel(lineStart("  - nested"), lineEnd("  - nested item") + 1))).toBe("nested item");
  });

  test("a task item skips the checkbox", () => {
    expect(text(sel(lineStart("- [ ]"), lineEnd("- [ ] a task") + 1))).toBe("a task");
  });

  test("a numbered item skips its number", () => {
    expect(text(sel(lineStart("1. numbered"), doc.length))).toBe("numbered");
  });

  test("a double-click on the marker selects the item's text", () => {
    expect(text(sel(lineStart("- first"), lineStart("- first") + 1))).toBe("first item");
  });

  test("a backwards line click keeps its direction", () => {
    const r = sel(lineEnd("- first item") + 1, lineStart("- first"));
    expect([r.anchor, r.head]).toEqual([lineEnd("- first item"), lineStart("first item")]);
  });

  test("the selected item gets a ¶ at its end", () => {
    const r = sel(lineStart("- first"), lineEnd("- first item") + 1);
    expect(paragraphMarkPositions(EditorState.create({ doc }).doc, [r])).toEqual([
      lineEnd("- first item"),
    ]);
  });

  test("a #tag at a line start is text, not a heading", () => {
    const d = "#tag here";
    const s = EditorState.create({ doc: d, extensions: [paragraphSelection] });
    const r = s.update({
      selection: EditorSelection.single(0, d.length),
      userEvent: "select.pointer",
    }).state.selection.main;
    expect([r.from, r.to]).toEqual([0, d.length]);
  });
});
