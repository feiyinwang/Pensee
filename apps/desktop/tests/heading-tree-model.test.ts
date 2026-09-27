import { describe, expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  TREE_STEP,
  collectOutline,
  indentForTreeDepth,
  ownerIndexAt,
  treeLinks,
} from "../src/components/editor-area/heading-tree-model";
import { withFullParse } from "./helpers/parsed-state";

function outlineOf(doc: string) {
  const state = withFullParse(
    EditorState.create({ doc, extensions: [markdown({ extensions: [GFM] })] }),
  );
  return collectOutline(state);
}

describe("collectOutline", () => {
  test("nests headings by level and records parents", () => {
    const doc = ["# A", "body", "## B", "### C", "## D", "# E"].join("\n");
    const outline = outlineOf(doc);
    expect(outline.map((h) => [h.level, h.depth, h.parent])).toEqual([
      [1, 0, -1],
      [2, 1, 0],
      [3, 2, 1],
      [2, 1, 0],
      [1, 0, -1],
    ]);
  });

  test("skipped levels collapse to one step", () => {
    const outline = outlineOf(["# A", "### B", "## C"].join("\n"));
    expect(outline.map((h) => [h.depth, h.parent])).toEqual([
      [0, -1],
      [1, 0],
      [1, 0],
    ]);
  });

  test("textFrom skips the hash marks", () => {
    const [h] = outlineOf("## Title");
    expect(h.from).toBe(0);
    expect(h.textFrom).toBe(3);
  });

  test("ignores # inside fenced code and nested blocks", () => {
    const doc = ["# A", "```", "# not a heading", "```", "> # quoted", "- # listed"].join("\n");
    expect(outlineOf(doc)).toHaveLength(1);
  });
});

describe("ownerIndexAt", () => {
  test("finds the heading that owns a position", () => {
    const doc = ["intro", "# A", "body", "## B", "more"].join("\n");
    const outline = outlineOf(doc);
    expect(ownerIndexAt(outline, 0)).toBe(-1);
    expect(ownerIndexAt(outline, doc.indexOf("body"))).toBe(0);
    expect(ownerIndexAt(outline, doc.indexOf("more"))).toBe(1);
  });
});

describe("treeLinks", () => {
  const doc = ["# A", "## B", "## C", "### D", "# E"].join("\n");

  test("maps each parent to its last visible child", () => {
    const outline = outlineOf(doc);
    const { visible, lastChild } = treeLinks(outline, () => false);
    expect(visible).toEqual([0, 1, 2, 3, 4]);
    expect([...lastChild]).toEqual([
      [0, 2],
      [2, 3],
    ]);
  });

  test("hidden headings drop out of the tree", () => {
    const outline = outlineOf(doc);
    const hiddenFrom = outline[3].from;
    const { visible, lastChild } = treeLinks(outline, (h) => h.from === hiddenFrom);
    expect(visible).toEqual([0, 1, 2, 4]);
    expect(lastChild.has(2)).toBe(false);
  });
});

test("indent steps one column per depth", () => {
  expect(indentForTreeDepth(0)).toBe(TREE_STEP);
  expect(indentForTreeDepth(2)).toBe(3 * TREE_STEP);
});
