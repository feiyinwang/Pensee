import { describe, expect, test } from "vite-plus/test";
import { spring } from "motion";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  accentPath,
  bulletItemAt,
  hopKick,
  __ballSpring,
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

describe("hopKick", () => {
  /** How far the ball swings sideways (px) when kicked with `velocity` by
   *  the ball's own spring: the hop's height. */
  const swing = (velocity: number) => {
    const run = spring({ ...__ballSpring, keyframes: [0, 0], velocity });
    let peak = 0;
    for (let ms = 0; ms <= 1000; ms += 1) peak = Math.max(peak, Math.abs(run.next(ms).value));
    return peak;
  };

  test("kicks left of the travel, either way, away from the text", () => {
    expect(hopKick(0, 34).vx).toBeLessThan(0);
    expect(hopKick(0, -34).vx).toBeLessThan(0);
    expect(hopKick(0, 34).vy).toBe(0);
  });

  test("a ~5px hop between rows, capped at 20px on a long jump", () => {
    expect(swing(hopKick(0, 34).vx)).toBeCloseTo(0.13 * 34, 1);
    expect(swing(hopKick(0, 600).vx)).toBeCloseTo(20, 0);
  });

  test("the ball settles fast: it looks there within --motion-settle", () => {
    const run = spring({ ...__ballSpring, keyframes: [0, 100] });
    expect(run.next(180).value).toBeGreaterThan(95);
  });
});
