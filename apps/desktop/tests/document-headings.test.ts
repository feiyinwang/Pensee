import { describe, expect, test } from "vite-plus/test";
import { buildSlugIndex, parseDocumentHeadings } from "../src/hooks/use-document-headings";

describe("parseDocumentHeadings", () => {
  test("returns empty array for empty content", () => {
    expect(parseDocumentHeadings("", { maxDepth: 3 })).toEqual([]);
  });

  test("extracts H1/H2/H3 headings with level and text", () => {
    const content = ["# Title", "Some body.", "## Section", "### Subsection", ""].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, "Title"],
      [2, "Section"],
      [3, "Subsection"],
    ]);
  });

  test("respects maxDepth", () => {
    const content = ["# A", "## B", "### C", "#### D"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 2 });
    expect(headings.map((h) => h.level)).toEqual([1, 2]);
  });

  test("computes line and pos for each heading", () => {
    const content = ["intro", "# Title", "para", "## Section"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    expect(headings).toEqual([
      expect.objectContaining({ level: 1, text: "Title", line: 1, pos: "intro\n".length }),
      expect.objectContaining({
        level: 2,
        text: "Section",
        line: 3,
        pos: "intro\n# Title\npara\n".length,
      }),
    ]);
  });

  test("skips headings inside fenced code blocks", () => {
    const content = ["# Real", "```", "# Fake", "## Also fake", "```", "## Real too"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    expect(headings.map((h) => h.text)).toEqual(["Real", "Real too"]);
  });

  test("supports tilde fences", () => {
    const content = ["# Real", "~~~", "# Fake", "~~~", "## Done"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    expect(headings.map((h) => h.text)).toEqual(["Real", "Done"]);
  });

  test("ignores ATX without space after hashes", () => {
    const content = ["#NotHeading", "# Heading"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    expect(headings.map((h) => h.text)).toEqual(["Heading"]);
  });

  test("strips trailing closing hashes from ATX headings", () => {
    expect(parseDocumentHeadings("## Title ##", { maxDepth: 3 })[0].text).toBe("Title");
  });

  test("ignores empty heading text", () => {
    expect(parseDocumentHeadings("# ", { maxDepth: 3 })).toEqual([]);
  });

  test("slug lowercases and hyphenates", () => {
    const headings = parseDocumentHeadings("# Hello, World!", { maxDepth: 3 });
    expect(headings[0].slug).toBe("hello-world");
  });

  test("slug strips punctuation but preserves unicode letters", () => {
    const headings = parseDocumentHeadings("# Café & Crème", { maxDepth: 3 });
    expect(headings[0].slug).toBe("café-crème");
  });

  test("dedupes colliding slugs with -2, -3 in document order", () => {
    const content = ["# Setup", "## Setup", "### Setup"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    expect(headings.map((h) => h.slug)).toEqual(["setup", "setup-2", "setup-3"]);
  });

  test("dedup walks deeper levels even when they're filtered from the rail", () => {
    const content = ["# Setup", "#### Setup", "## Setup"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3, slugDepth: 6 });
    expect(headings.map((h) => [h.level, h.slug])).toEqual([
      [1, "setup"],
      [2, "setup-3"],
    ]);
  });
});

describe("parseDocumentHeadings relative depth", () => {
  test("a doc that starts at H2 sits flush at depth 0", () => {
    const content = ["## A", "### B", "## C"].join("\n");
    expect(parseDocumentHeadings(content, { maxDepth: 6 }).map((h) => h.depth)).toEqual([0, 1, 0]);
  });

  test("skipped levels collapse to one step", () => {
    const content = ["# A", "### B", "###### C"].join("\n");
    expect(parseDocumentHeadings(content, { maxDepth: 6 }).map((h) => h.depth)).toEqual([0, 1, 2]);
  });

  test("returning to a shallower level pops back down", () => {
    const content = ["## A", "### B", "##### C", "## D", "# E", "## F"].join("\n");
    expect(parseDocumentHeadings(content, { maxDepth: 6 }).map((h) => h.depth)).toEqual([
      0, 1, 2, 0, 0, 1,
    ]);
  });

  test("depth is relative to the rendered set, not the filtered-out levels", () => {
    const content = ["# A", "#### B", "## C"].join("\n");
    expect(
      parseDocumentHeadings(content, { maxDepth: 2, slugDepth: 6 }).map((h) => [h.level, h.depth]),
    ).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });

  test("a flat doc has no depth at all", () => {
    const content = ["## A", "## B", "## C"].join("\n");
    expect(parseDocumentHeadings(content, { maxDepth: 6 }).map((h) => h.depth)).toEqual([0, 0, 0]);
  });

  test("headings inside fences do not disturb the depth stack", () => {
    const content = ["# A", "```", "###### Fake", "```", "## B"].join("\n");
    expect(parseDocumentHeadings(content, { maxDepth: 6 }).map((h) => [h.text, h.depth])).toEqual([
      ["A", 0],
      ["B", 1],
    ]);
  });

  test("defaults to the full H1–H6 range", () => {
    const content = ["# A", "## B", "### C", "#### D", "##### E", "###### F"].join("\n");
    expect(parseDocumentHeadings(content).map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("buildSlugIndex", () => {
  test("maps each slug to its heading", () => {
    const content = ["# A", "## B", "### A"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    const index = buildSlugIndex(headings);
    expect(index.size).toBe(3);
    expect(index.get("a")?.level).toBe(1);
    expect(index.get("a-2")?.level).toBe(3);
    expect(index.get("b")?.level).toBe(2);
  });
});
