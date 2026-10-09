import { describe, expect, test } from "vite-plus/test";
import {
  blockIdOnLine,
  blockLinkPage,
  blockText,
  findBlock,
  minimalChange,
  newBlockId,
  parseBlockEmbedTarget,
  replaceBlock,
} from "../src/lib/block-refs";

describe("parseBlockEmbedTarget", () => {
  test("page and id", () => {
    expect(parseBlockEmbedTarget("Notes/Trip#^ab12cd")).toEqual({
      page: "Notes/Trip",
      id: "ab12cd",
    });
  });
  test("same page", () => {
    expect(parseBlockEmbedTarget("#^x1")).toEqual({ page: "", id: "x1" });
  });
  test("alias is ignored", () => {
    expect(parseBlockEmbedTarget("Trip#^x1|label")).toEqual({ page: "Trip", id: "x1" });
  });
  test("headings, pictures and plain pages are not block refs", () => {
    expect(parseBlockEmbedTarget("Trip#Day one")).toBeNull();
    expect(parseBlockEmbedTarget("photo.png")).toBeNull();
    expect(parseBlockEmbedTarget("Trip")).toBeNull();
  });
});

describe("findBlock / blockText", () => {
  test("a paragraph runs up to the blank line above its id", () => {
    const text = "# Title\n\nfirst line\nsecond line ^p1\n\nafter\n";
    expect(blockText(text, "p1")).toBe("first line\nsecond line");
  });
  test("a paragraph stops under a heading with no blank line", () => {
    expect(blockText("# Title\nbody ^p1\n", "p1")).toBe("body");
  });
  test("a list item is its own line", () => {
    const text = "- one\n- two ^li\n  - child\n- three\n";
    expect(blockText(text, "li")).toBe("- two");
  });
  test("a picture", () => {
    expect(blockText("text\n\n![](pics/a.png) ^img\n", "img")).toBe("![](pics/a.png)");
  });
  test("missing id", () => {
    expect(findBlock("nothing here\n", "zz")).toBeNull();
  });
  test("an id is matched whole, not as a prefix", () => {
    expect(blockText("a ^abc\n\nb ^ab\n", "ab")).toBe("b");
  });
  test("first block of the file", () => {
    expect(findBlock("hello ^h", "h")).toEqual({ from: 0, to: 5, end: 8 });
  });
});

describe("replaceBlock", () => {
  test("keeps the id and everything around the block", () => {
    const text = "before\n\nold text ^p1\n\nafter\n";
    expect(replaceBlock(text, "p1", "new text")).toBe("before\n\nnew text ^p1\n\nafter\n");
  });
  test("multi-line paragraph", () => {
    expect(replaceBlock("a\nb ^p\n", "p", "c")).toBe("c ^p\n");
  });
  test("missing id writes nothing", () => {
    expect(replaceBlock("a\n", "p", "c")).toBeNull();
  });
});

describe("helpers", () => {
  test("blockIdOnLine", () => {
    expect(blockIdOnLine("- item ^k9")).toBe("k9");
    expect(blockIdOnLine("x^k9")).toBeNull();
    expect(blockIdOnLine("plain")).toBeNull();
  });
  test("newBlockId is six base-36 characters", () => {
    expect(newBlockId()).toMatch(/^[a-z0-9]{6}$/);
  });
  test("minimalChange keeps shared prefix and suffix", () => {
    expect(minimalChange("hello world", "hello there world")).toEqual({
      from: 6,
      to: 6,
      insert: "there ",
    });
    expect(minimalChange("same", "same")).toBeNull();
  });
  test("blockLinkPage: stem at the root, workspace path below it", () => {
    expect(blockLinkPage("/ws/Trip.md", "/ws")).toBe("Trip");
    expect(blockLinkPage("/ws/notes/Trip.md", "/ws/")).toBe("notes/Trip");
    expect(blockLinkPage("/elsewhere/Trip.md", "/ws")).toBe("Trip");
  });
});
