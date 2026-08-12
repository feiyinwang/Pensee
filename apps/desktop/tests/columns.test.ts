import { describe, expect, test } from "vite-plus/test";
import {
  parseColumns,
  serializeColumns,
  renderBlockMarkdown,
  type Column,
} from "../src/components/editor-area/columns-decorations";

const ROW = [
  '<div class="wr-row" style="display:flex;flex-wrap:wrap;gap:16px">',
  '<div class="wr-col" style="flex:1 1 0;min-width:150px">',
  "",
  "## 左边是标题",
  "",
  "- 一条",
  "- 两条",
  "",
  "</div>",
  '<div class="wr-col" style="flex:1.45 1 0;min-width:150px">',
  "",
  "![](assets/b.png)",
  "",
  "说明 $O(n)$",
  "",
  "</div>",
  "</div>",
].join("\n");

const LEGACY_FIGURE_ROW = [
  '<div class="wr-row" style="display:flex;flex-wrap:wrap;gap:16px">',
  '<figure style="flex:2 1 0;min-width:150px">',
  "",
  "![](a.png)",
  "",
  "老说明",
  "",
  "</figure>",
  '<figure style="flex:1 1 0;min-width:150px">',
  "",
  "![](b.png)",
  "",
  "</figure>",
  "</div>",
].join("\n");

describe("parseColumns", () => {
  test("keeps each cell's markdown verbatim, including headings and lists", () => {
    const columns = parseColumns(ROW);
    expect(columns).not.toBeNull();
    expect(columns).toHaveLength(2);
    expect(columns![0]!.md).toBe("## 左边是标题\n\n- 一条\n- 两条");
    expect(columns![0]!.grow).toBe(1);
    expect(columns![1]!.md).toBe("![](assets/b.png)\n\n说明 $O(n)$");
    expect(columns![1]!.grow).toBe(1.45);
  });

  test("still reads rows written with <figure> by the first version", () => {
    const columns = parseColumns(LEGACY_FIGURE_ROW);
    expect(columns).toHaveLength(2);
    expect(columns![0]!.grow).toBe(2);
    expect(columns![0]!.md).toBe("![](a.png)\n\n老说明");
  });

  test("returns null for anything that is not a wr-row", () => {
    expect(parseColumns("<div>plain</div>")).toBeNull();
    expect(parseColumns('<div class="wr-row"></div>')).toBeNull();
  });
});

describe("serializeColumns", () => {
  test("round-trips without drift and is byte-stable on a second pass", () => {
    const once = parseColumns(ROW)!;
    const text = serializeColumns(once);
    const twice = parseColumns(text)!;
    expect(twice).toEqual(once);
    expect(serializeColumns(twice)).toBe(text);
  });

  test("keeps the blank line after the opening tag so other renderers see markdown", () => {
    const text = serializeColumns([{ md: "- one", grow: 1 }]);
    expect(text).toContain(
      '<div class="wr-col" style="flex:1 1 0;min-width:150px">\n\n- one\n\n</div>',
    );
  });

  test('upgrades legacy <figure> cells to <div class="wr-col"> on the next write', () => {
    const text = serializeColumns(parseColumns(LEGACY_FIGURE_ROW)!);
    expect(text).toContain('class="wr-col"');
    expect(text).not.toContain("<figure");
  });

  test("clamps a nonsense grow back to 1", () => {
    expect(serializeColumns([{ md: "x", grow: 0 }])).toContain("flex:1 1 0");
    expect(serializeColumns([{ md: "x", grow: NaN } as Column])).toContain("flex:1 1 0");
  });
});

describe("renderBlockMarkdown", () => {
  test("headings, rules and standalone images", () => {
    expect(renderBlockMarkdown("## T")).toBe("<h2>T</h2>");
    expect(renderBlockMarkdown("###### deep")).toBe("<h6>deep</h6>");
    expect(renderBlockMarkdown("---")).toBe("<hr>");
    expect(renderBlockMarkdown("![a](b.png)")).toBe(
      '<p class="wr-img"><img alt="a" src="b.png"></p>',
    );
  });

  test("lists, quotes and fences", () => {
    expect(renderBlockMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(renderBlockMarkdown("1. a")).toBe("<ol><li>a</li></ol>");
    expect(renderBlockMarkdown("> q")).toBe("<blockquote><p>q</p></blockquote>");
    expect(renderBlockMarkdown("```\na<b\n```")).toBe("<pre><code>a&lt;b</code></pre>");
  });

  test("a heading right after a paragraph is not swallowed into it", () => {
    expect(renderBlockMarkdown("intro\n## T")).toBe("<p>intro</p><h2>T</h2>");
  });

  test("math renders and does not eat the surrounding emphasis", () => {
    const html = renderBlockMarkdown("$O(n)$ is **bad**");
    expect(html).toContain("<strong>bad</strong>");
    expect(html).toContain("katex");
  });

  test("escapes html so a column can never inject markup", () => {
    expect(renderBlockMarkdown("<script>alert(1)</script>")).not.toContain("<script");
  });

  test("an empty column produces nothing", () => {
    expect(renderBlockMarkdown("")).toBe("");
    expect(renderBlockMarkdown("   \n  ")).toBe("");
  });
});
