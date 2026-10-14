import { describe, expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  accentPath,
  bulletItemAt,
  hopControl,
  pathLength,
  railGeometry,
  segmentsToPath,
  sharedLength,
  type RailNode,
} from "../src/lib/prosemark-core/list/tree-rail";
import { withFullParse } from "./helpers/parsed-state";

// a            (x 10)
//   a1         (x 40)
//   a2
// b
const nodes: RailNode[] = [
  { id: 1, parent: null, group: 0, x: 10, y: 10, task: false },
  { id: 2, parent: 1, group: 5, x: 40, y: 40, task: false },
  { id: 3, parent: 1, group: 5, x: 40, y: 70, task: false },
  { id: 4, parent: null, group: 0, x: 10, y: 100, task: false },
];

describe("railGeometry", () => {
  test("a top-level list is one rail down its bullets; a nested list drops from its parent and curves into each item", () => {
    const { base } = railGeometry(nodes);
    expect(segmentsToPath(base)).toBe(
      "M10 10V100" + "M10 10V62" + "M10 32A8 8 0 0 0 18 40H40" + "M10 62A8 8 0 0 0 18 70H40",
    );
  });

  test("the curve shrinks to fit a narrow indent", () => {
    const { base } = railGeometry([
      { id: 1, parent: null, group: 0, x: 10, y: 10, task: false },
      { id: 2, parent: 1, group: 5, x: 20, y: 40, task: false },
    ]);
    expect(segmentsToPath(base)).toContain("A5 5 0 0 0 15 40H20");
  });
});

describe("accentPath", () => {
  const geo = railGeometry(nodes);

  test("a top-level item: down the rail from the list's first item", () => {
    expect(segmentsToPath(accentPath(geo, 4))).toBe("M10 10V100");
    expect(accentPath(geo, 1)).toEqual([]);
  });

  test("a nested item: down the parent's line and through its curve", () => {
    expect(segmentsToPath(accentPath(geo, 3))).toBe("M10 10V62A8 8 0 0 0 18 70H40");
  });

  test("siblings share the run down to where they part", () => {
    const a1 = accentPath(geo, 2);
    const a2 = accentPath(geo, 3);
    expect(sharedLength(a1, a2)).toBe(22);
    expect(sharedLength(a2, a2)).toBeCloseTo(pathLength(a2));
    expect(sharedLength(accentPath(geo, 4), a2)).toBe(52);
  });
});

describe("bulletItemAt", () => {
  const state = withFullParse(
    EditorState.create({
      doc: "- a\n  - a1\n1. one\n\ntext",
      extensions: [markdown({ extensions: GFM })],
    }),
  );

  test("finds the innermost bullet item", () => {
    expect(bulletItemAt(state, 1)).toBe(0);
    expect(bulletItemAt(state, 9)).toBe(6);
  });

  test("at the end of an item's text, that item (where the caret types)", () => {
    expect(bulletItemAt(state, 3)).toBe(0); // `- a|`
    expect(bulletItemAt(state, 10)).toBe(6); // `  - a1|`
  });

  test("ignores ordered items and plain text", () => {
    expect(bulletItemAt(state, 13)).toBeNull();
    expect(bulletItemAt(state, state.doc.length)).toBeNull();
  });
});

describe("hopControl", () => {
  // The curve's highest point off the straight line: half the control's offset.
  const peakLeft = (start: { x: number; y: number }, to: { x: number; y: number }) =>
    (start.x + to.x) / 2 - hopControl(start, to).x;

  test("hops left of the travel, either way, like beui's arc", () => {
    expect(hopControl({ x: 10, y: 0 }, { x: 10, y: 34 }).x).toBeLessThan(10);
    expect(hopControl({ x: 10, y: 34 }, { x: 10, y: 0 }).x).toBeLessThan(10);
  });

  test("a ~5px hop between rows, capped near 20px on a long jump", () => {
    expect(peakLeft({ x: 0, y: 0 }, { x: 0, y: 34 }) / 2).toBeCloseTo(4.42, 1);
    expect(peakLeft({ x: 0, y: 0 }, { x: 0, y: 600 }) / 2).toBe(20);
  });

  test("across levels the curve still bows outward, away from the text", () => {
    const c = hopControl({ x: 40, y: 0 }, { x: 10, y: 34 });
    expect(c.x).toBeLessThan(25);
  });
});
