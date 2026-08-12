import { describe, expect, test } from "vite-plus/test";
import {
  parseColumns,
  serializeColumns,
  renderBlockMarkdown,
  splitBlocks,
  splitBands,
  joinBands,
  withBand,
  appendToBand,
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

describe("splitBlocks", () => {
  test("splits at blank lines and keeps a list together", () => {
    expect(splitBlocks("a\n\nb")).toEqual(["a", "b"]);
    expect(splitBlocks("- one\n- two\n\nafter")).toEqual(["- one\n- two", "after"]);
  });

  test("a fence keeps its own blank lines instead of being cut in half", () => {
    expect(splitBlocks("```\na\n\nb\n```\n\ntail")).toEqual(["```\na\n\nb\n```", "tail"]);
  });

  test("a multi-line $$ block stays whole", () => {
    expect(splitBlocks("$$\nE=mc^2\n\nx\n$$\n\nnote")).toEqual(["$$\nE=mc^2\n\nx\n$$", "note"]);
  });

  test("drops empty input and stray blank lines", () => {
    expect(splitBlocks("")).toEqual([]);
    expect(splitBlocks("\n\n  \n")).toEqual([]);
  });
});

describe("splitBands", () => {
  test("the first standalone image is the anchor", () => {
    expect(splitBands("lead\n\n![](a.png)\n\ncaption")).toEqual({
      above: "lead",
      anchor: "![](a.png)",
      below: "caption",
    });
  });

  test("a caption of several paragraphs is one band, not three", () => {
    expect(splitBands("![](a.png)\n\none\n\ntwo").below).toBe("one\n\ntwo");
  });

  test("no image: the first block anchors, so a text column still lines up", () => {
    expect(splitBands("first\n\nsecond")).toEqual({
      above: "",
      anchor: "first",
      below: "second",
    });
  });

  test("an empty column has empty bands", () => {
    expect(splitBands("")).toEqual({ above: "", anchor: "", below: "" });
  });

  test("an inline image in a sentence is not an anchor", () => {
    expect(splitBands("see ![](a.png) here").anchor).toBe("see ![](a.png) here");
  });
});

describe("joinBands / withBand", () => {
  test("round-trips a column without drift", () => {
    const md = "lead\n\n![](a.png)\n\ncaption";
    expect(joinBands(splitBands(md))).toBe(md);
  });

  test("an empty value removes the band and leaves no blank lines", () => {
    expect(withBand("![](a.png)\n\ncaption", "below", "")).toBe("![](a.png)");
    expect(withBand("![](a.png)\n\ncaption", "below", "   ")).toBe("![](a.png)");
  });

  test("writing a caption into a picture-only column appends below it", () => {
    expect(withBand("![](a.png)", "below", "说明")).toBe("![](a.png)\n\n说明");
  });

  test("editing one band never touches the others", () => {
    expect(withBand("lead\n\n![](a.png)\n\nold", "below", "new")).toBe("lead\n\n![](a.png)\n\nnew");
  });
});

describe("appendToBand", () => {
  test("dropping below an existing caption lands under it", () => {
    expect(appendToBand("![](a.png)\n\none", "below", "two")).toBe("![](a.png)\n\none\n\ntwo");
  });

  test("dropping above lands directly above the picture", () => {
    expect(appendToBand("lead\n\n![](a.png)", "above", "second")).toBe(
      "lead\n\nsecond\n\n![](a.png)",
    );
  });

  test("a fourth band never appears — it merges into the band it was dropped in", () => {
    const once = appendToBand("![](a.png)", "below", "one");
    const twice = appendToBand(once, "below", "two");
    expect(splitBands(twice)).toEqual({
      above: "",
      anchor: "![](a.png)",
      below: "one\n\ntwo",
    });
  });

  test("dropping nothing changes nothing", () => {
    expect(appendToBand("![](a.png)\n\nc", "below", "   ")).toBe("![](a.png)\n\nc");
  });

  test("an empty column takes the drop as its only content", () => {
    expect(appendToBand("", "below", "hi")).toBe("hi");
  });
});
