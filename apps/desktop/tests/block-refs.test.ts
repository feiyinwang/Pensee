import { describe, expect, test } from "vite-plus/test";
import {
  blockIdOnLine,
  blockIdsInText,
  blockLinkPage,
  blockAfterInsertion,
  blockText,
  displayAsBullet,
  isPictureBlock,
  findBlock,
  minimalChange,
  newBlockId,
  parseBlockEmbedTarget,
  referenceFromClipboard,
  referenceInsertion,
  referencesInText,
  replaceBlock,
  restoreMarker,
  bodyStaysOneBlock,
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
  test("a list item carries everything nested under it", () => {
    const text = "- one\n- two ^li\n  - child\n\n    deeper\n- three\n";
    expect(blockText(text, "li")).toBe("- two\n  - child\n\n    deeper");
  });
  test("a list item with no children is its line", () => {
    expect(blockText("- a ^li\n- b\n", "li")).toBe("- a");
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
    expect(findBlock("hello ^h", "h")).toEqual({
      from: 0,
      to: 8,
      idFrom: 5,
      idTo: 8,
      idOnFirstLine: false,
    });
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

describe("backlink helpers", () => {
  test("blockIdsInText lists each defined id once", () => {
    expect(blockIdsInText("a ^x1\n\n- b ^y2\nc ^x1\nno^z\n")).toEqual(["x1", "y2"]);
  });
  test("referencesInText finds embeds and inline links, whole ids only", () => {
    const text = "intro\n![[Source#^abc]]\nsee [[Source#^abc|that]] and [[Source#^abcd]]\n";
    expect(referencesInText(text, new Set(["abc"]))).toEqual([
      { id: "abc", line: 2, text: "![[Source#^abc]]" },
      { id: "abc", line: 3, text: "see [[Source#^abc|that]] and [[Source#^abcd]]" },
    ]);
  });
  test("referencesInText ignores the definition itself", () => {
    expect(referencesInText("block ^abc\n", new Set(["abc"]))).toEqual([]);
  });
});

describe("paste as reference", () => {
  test("referenceFromClipboard takes one block reference, embed or link", () => {
    expect(referenceFromClipboard(" ![[Trip#^a1]]\n")).toBe("![[Trip#^a1]]");
    expect(referenceFromClipboard("[[notes/Trip#^a1]]")).toBe("![[notes/Trip#^a1]]");
    expect(referenceFromClipboard("[[Trip]]")).toBeNull();
    expect(referenceFromClipboard("see ![[Trip#^a1]]")).toBeNull();
    expect(referenceFromClipboard("")).toBeNull();
  });
  test("referenceInsertion: blank line, list item, paragraph", () => {
    expect(referenceInsertion("   ", "E")).toEqual({ replaceLine: true, text: "E" });
    expect(referenceInsertion("  - milk", "E")).toEqual({ replaceLine: false, text: "\n  - E" });
    expect(referenceInsertion("3. eggs", "E")).toEqual({ replaceLine: false, text: "\n4. E" });
    expect(referenceInsertion("Some text", "E")).toEqual({ replaceLine: false, text: "\n\nE" });
  });
});

describe("bullet subtrees", () => {
  test("replacing a bullet keeps its id on the bullet line, children below", () => {
    const text = "- a ^li\n  - old\n- next\n";
    expect(replaceBlock(text, "li", "- a\n  - new\n  - more")).toBe(
      "- a ^li\n  - new\n  - more\n- next\n",
    );
  });
  test("a bullet that gains its first child keeps the id on the bullet", () => {
    expect(replaceBlock("- a ^li\n- b\n", "li", "- a\n  - c")).toBe("- a ^li\n  - c\n- b\n");
  });
  test("bodyStaysOneBlock: children yes, siblings and split paragraphs no", () => {
    expect(bodyStaysOneBlock("- a\n  - child", "x")).toBe(true);
    expect(bodyStaysOneBlock("- a\n- sibling", "x")).toBe(false);
    expect(bodyStaysOneBlock("one\ntwo", "x")).toBe(true);
    expect(bodyStaysOneBlock("one\n\ntwo", "x")).toBe(false);
    expect(bodyStaysOneBlock("", "x")).toBe(true);
  });
});

describe("numbered items show as bullets elsewhere", () => {
  test("6. becomes a bullet for display and comes back on write", () => {
    const shown = displayAsBullet("6. Harness tools\n   - brands");
    expect(shown).toEqual({ display: "- Harness tools\n   - brands", marker: "6." });
    expect(restoreMarker("- Harness tools, edited\n   - brands", shown.marker)).toBe(
      "6. Harness tools, edited\n   - brands",
    );
  });
  test("bullets, tasks under bullets and paragraphs pass through", () => {
    expect(displayAsBullet("- a")).toEqual({ display: "- a", marker: null });
    expect(displayAsBullet("Plain")).toEqual({ display: "Plain", marker: null });
    expect(displayAsBullet("2) [ ] task").display).toBe("- [ ] task");
    expect(restoreMarker("- a", null)).toBe("- a");
  });
});

describe("Enter after a linked block", () => {
  test("a new sibling item in a list, a new line elsewhere", () => {
    expect(blockAfterInsertion("  - ![[A#^x]]")).toBe("\n  - ");
    expect(blockAfterInsertion("3. ![[A#^x]]")).toBe("\n4. ");
    expect(blockAfterInsertion("![[A#^x]]")).toBe("\n");
    expect(blockAfterInsertion("![[A#^x]]", true)).toBe("\n- ");
  });
});

test("isPictureBlock", () => {
  expect(isPictureBlock("![chart](a/b.png)")).toBe(true);
  expect(isPictureBlock("![[photo.JPG|300]]")).toBe(true);
  expect(isPictureBlock("![chart](a.png) and words")).toBe(false);
  expect(isPictureBlock("- item")).toBe(false);
});
