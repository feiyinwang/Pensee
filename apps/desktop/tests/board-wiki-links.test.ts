import { describe, expect, test } from "vite-plus/test";
import {
  applyLinkCompletion,
  linkQueryAt,
} from "../src/components/editor-area/board/board-link-complete";
import { parseInline, wrapRich } from "../src/components/editor-area/board/board-render";

describe("board [[links]]", () => {
  test("a link becomes its own run, showing the page name or alias", () => {
    expect(parseInline("see [[Plans]] and [[Ideas/Q4|this]]")).toEqual([
      { text: "see " },
      { text: "Plans", ln: "Plans" },
      { text: " and " },
      { text: "this", ln: "Ideas/Q4|this" },
    ]);
  });

  test("keeps emphasis around a link and markdown out of its target", () => {
    expect(parseInline("**go [[my_page]]**")).toEqual([
      { text: "go ", b: true },
      { text: "my_page", b: true, ln: "my_page" },
    ]);
    expect(parseInline("[[unclosed")).toEqual([{ text: "[[unclosed" }]);
  });

  test("a wrapped link keeps its target on every piece", () => {
    const lines = wrapRich("[[A long page name]]", 14, 40);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) for (const r of line) expect(r.ln).toBe("A long page name");
  });

  test("finds the open query at the caret", () => {
    expect(linkQueryAt("x [[Pla", 7)).toEqual({ from: 2, query: "Pla" });
    expect(linkQueryAt("x [[", 4)).toBeNull();
    expect(linkQueryAt("[[Done]] ", 9)).toBeNull();
    expect(linkQueryAt("[[Page#He", 9)).toBeNull();
  });

  test("completing replaces the query and an auto-closed ]]", () => {
    expect(applyLinkCompletion("x [[Pla", 2, 7, "Plans")).toEqual({
      value: "x [[Plans]]",
      caret: 11,
    });
    expect(applyLinkCompletion("[[Pla]] y", 0, 5, "Plans")).toEqual({
      value: "[[Plans]] y",
      caret: 9,
    });
  });
});
