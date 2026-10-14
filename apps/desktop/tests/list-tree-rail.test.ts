import { describe, expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  bulletItemAt,
  guideGeometry,
  guidePath,
  type RailNode,
} from "../src/lib/prosemark-core/list/tree-rail";
import { withFullParse } from "./helpers/parsed-state";

// a            (x 10, y 10)
//   a1         (x 40, y 40)
//     a1x      (x 70, y 70, wraps to bottom 115)
//   a2         (x 40, y 130)
// b            (x 10, y 160)
const node = (id: number, parent: number | null, x: number, y: number, bottom = y + 15) =>
  ({ id, parent, x, y, bottom, task: false }) satisfies RailNode;
const nodes: RailNode[] = [
  node(1, null, 10, 10, 145),
  node(2, 1, 40, 40, 115),
  node(3, 2, 70, 70, 115),
  node(4, 1, 40, 130),
  node(5, null, 10, 160),
];

describe("guideGeometry", () => {
  test("one straight guide per nested list, at its parent's column; none for the top level", () => {
    expect(guideGeometry(nodes).map(guidePath)).toEqual(["M10 20V137", "M40 50V107"]);
  });

  test("a guide reaches the end of a wrapped last child", () => {
    const [, inner] = guideGeometry(nodes);
    expect(inner?.parent).toBe(2);
    expect(inner?.segments).toEqual([[50, 115 - 8]]);
  });

  test("a task parent leaves room for its box", () => {
    const [guide] = guideGeometry([{ ...node(1, null, 10, 10), task: true }, node(2, 1, 40, 40)]);
    expect(guide?.segments[0]?.[0]).toBe(24);
  });

  test("a child whose parent is out of the scan draws nothing", () => {
    expect(guideGeometry([node(2, 99, 40, 40)])).toEqual([]);
  });

  test("text outside the list's indent cuts every guide it would cross", () => {
    // A lazy continuation under a1x (y 116..130) sits at the content edge.
    const paths = guideGeometry(nodes, [{ top: 116, bottom: 130 }]).map(guidePath);
    expect(paths).toEqual(["M10 20V108", "M40 50V107"]);
  });

  test("a guide resumes below the text when more children follow", () => {
    const [outer] = guideGeometry(nodes, [{ top: 116, bottom: 120 }]);
    expect(outer?.segments).toEqual([
      [20, 108],
      [128, 137],
    ]);
  });

  test("text right under the parent leaves no stub above it", () => {
    const [outer] = guideGeometry(nodes, [{ top: 18, bottom: 30 }]);
    expect(outer?.segments[0]).toEqual([38, 137]);
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
