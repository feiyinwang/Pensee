import { describe, expect, test } from "vite-plus/test";
import { rebaseMarkdownLinks, relativePathFrom } from "../src/lib/rebase-markdown-links";

describe("relativePathFrom", () => {
  test("walks up and down from the shared prefix", () => {
    expect(relativePathFrom("/v/notes/a", "/v/notes/b/img.png")).toBe("../b/img.png");
    expect(relativePathFrom("/v/notes", "/v/notes/assets/img.png")).toBe("assets/img.png");
    expect(relativePathFrom("/v/notes/deep/er", "/v/img.png")).toBe("../../../img.png");
  });
});

describe("rebaseMarkdownLinks", () => {
  test("rewrites a relative image into a sibling folder", () => {
    expect(
      rebaseMarkdownLinks("![中枢分解图](2026-10-09-assets/x.png)", "/v/journal", "/v/projects"),
    ).toBe("![中枢分解图](../journal/2026-10-09-assets/x.png)");
  });

  test("keeps the same text when the folder doesn't change", () => {
    const text = "![a](assets/x.png)";
    expect(rebaseMarkdownLinks(text, "/v/a", "/v/a")).toBe(text);
  });

  test("decodes and re-encodes destinations with spaces, keeps titles and fragments", () => {
    expect(rebaseMarkdownLinks('![a](<my assets/x.png> "t")', "/v/a", "/v")).toBe(
      '![a](<a/my assets/x.png> "t")',
    );
    expect(rebaseMarkdownLinks("[n](other.md#Heading)", "/v/a", "/v/b")).toBe(
      "[n](../a/other.md#Heading)",
    );
  });

  test("leaves URLs, absolute paths, anchors, and fenced code alone", () => {
    const text = [
      "![r](https://e.com/x.png) [m](mailto:a@b.c) ![abs](/tmp/x.png) [h](#top)",
      "```",
      "![code](assets/x.png)",
      "```",
    ].join("\n");
    expect(rebaseMarkdownLinks(text, "/v/a", "/v/b")).toBe(text);
  });
});
