import { describe, expect, test } from "vite-plus/test";
import {
  toggleEmphasis,
  toggleEmphasisAll,
} from "../src/components/editor-area/board/board-emphasis";
import type { ShapeEl } from "../src/components/editor-area/board/board-model";
import {
  parseInline,
  shapeFitHeight,
  shapeLabel,
} from "../src/components/editor-area/board/board-render";

describe("parseInline", () => {
  test("reads bold, italic and both, removing the marks", () => {
    expect(parseInline("a **b** *c* ***d*** _e_")).toEqual([
      { text: "a " },
      { text: "b", b: true },
      { text: " " },
      { text: "c", i: true },
      { text: " " },
      { text: "d", b: true, i: true },
      { text: " " },
      { text: "e", i: true },
    ]);
  });

  test("nests italic inside bold", () => {
    expect(parseInline("**x *y* z**")).toEqual([
      { text: "x ", b: true },
      { text: "y", b: true, i: true },
      { text: " z", b: true },
    ]);
  });

  test("leaves arithmetic, snake_case and unclosed marks alone", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([{ text: "2 * 3 * 4" }]);
    expect(parseInline("snake_case_name")).toEqual([{ text: "snake_case_name" }]);
    expect(parseInline("**open")).toEqual([{ text: "**open" }]);
  });
});

describe("toggleEmphasis", () => {
  test("wraps and unwraps a selection", () => {
    const on = toggleEmphasis("say hi now", 4, 6, "bold");
    expect(on).toEqual({ value: "say **hi** now", start: 6, end: 8 });
    expect(toggleEmphasis(on.value, on.start, on.end, "bold")).toEqual({
      value: "say hi now",
      start: 4,
      end: 6,
    });
  });

  test("adds italic to bold as ***, and removes just one of them", () => {
    const both = toggleEmphasis("**hi**", 2, 4, "italic");
    expect(both.value).toBe("***hi***");
    expect(toggleEmphasis(both.value, both.start, both.end, "bold").value).toBe("*hi*");
  });

  test("an empty selection inserts a pair around the caret", () => {
    expect(toggleEmphasis("ab", 1, 1, "italic")).toEqual({ value: "a**b", start: 2, end: 2 });
  });

  test("toggles each line of a multi-line selection", () => {
    expect(toggleEmphasis("one\ntwo", 0, 7, "bold").value).toBe("**one**\n**two**");
  });

  test("toggles a whole label", () => {
    expect(toggleEmphasisAll("Hello\nworld", "bold")).toBe("**Hello**\n**world**");
    expect(toggleEmphasisAll("**Hello**", "bold")).toBe("Hello");
    // Marks already inside the text don't tangle with the new ones.
    const it = toggleEmphasisAll("Plain **bold** and *italic*", "italic");
    expect(it).toBe("*Plain **bold** and italic*");
    expect(parseInline(it).every((r) => r.i)).toBe(true);
    const bold = toggleEmphasisAll("Plain *italic* end", "bold");
    expect(bold).toBe("**Plain _italic_ end**");
    expect(parseInline(bold).every((r) => r.b)).toBe(true);
    expect(parseInline(bold).find((r) => r.text === "italic")?.i).toBe(true);
    expect(toggleEmphasisAll(it, "italic")).toBe("Plain **bold** and italic");
  });
});

describe("shape label truncation", () => {
  const shape = (tx: string, h = 60) =>
    ({
      id: "r",
      t: "roundRect",
      x: 0,
      y: 0,
      w: 160,
      h,
      a: 0,
      op: 1,
      st: { s: "ink", f: "none", w: 1.5, d: "solid", r: 8 },
      lb: { tx, sz: 14, al: "c" },
    }) as ShapeEl;

  test("short text fits with no caret", () => {
    expect(shapeLabel(shape("Hello"))?.caret).toBeNull();
  });

  test("overflowing text is cut with an ellipsis and an expand caret", () => {
    const el = shape("word ".repeat(80).trim());
    const label = shapeLabel(el)!;
    expect(label.caret).toBe("expand");
    const last = label.lines[label.lines.length - 1];
    expect(last[last.length - 1].text.endsWith("…")).toBe(true);
    expect(shapeFitHeight(el)).toBeGreaterThan(el.h);
  });

  test("a grown shape shows a collapse caret", () => {
    const el = shape("word ".repeat(80).trim());
    el.ex = el.h;
    el.h = shapeFitHeight(el);
    expect(shapeLabel(el)?.caret).toBe("collapse");
  });
});
