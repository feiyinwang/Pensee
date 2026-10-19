import { describe, expect, it, test } from "vite-plus/test";

import {
  bookFileOf,
  bookHighlightId,
  authorFromFileName,
  authorOf,
  bookHighlightsIn,
  bookPlace,
  cleanBookTitle,
  sameAuthor,
  newBookNote,
  parseBookHighlightId,
  withBookHighlight,
  withoutBookHighlight,
} from "../src/lib/book-highlights";
import { parseFrontmatter } from "../src/lib/frontmatter";

const p = (section: number, start: number, end: number) =>
  ({ unit: "p", section, start, end }) as const;

describe("bookPlace", () => {
  it("names a PDF page as is and an EPUB section from 1", () => {
    expect(bookPlace(p(12, 0, 5))).toBe("page 12");
    expect(bookPlace({ unit: "s", section: 0, start: 65, end: 93 })).toBe("section 1");
  });
});

describe("book highlight ids", () => {
  it("round-trips a location", () => {
    expect(bookHighlightId(p(42, 10, 60))).toBe("bk-p42-10-60");
    expect(parseBookHighlightId("bk-p42-10-60")).toEqual(p(42, 10, 60));
    expect(parseBookHighlightId("bk-s3-0-5")).toEqual({ unit: "s", section: 3, start: 0, end: 5 });
  });

  it("ignores Apple Books ids and empty ranges", () => {
    expect(parseBookHighlightId("bk-1a2b3c4d5e6f")).toBeNull();
    expect(parseBookHighlightId("bk-p1-5-5")).toBeNull();
  });
});

describe("withBookHighlight", () => {
  const page = "# Book\n\n## Highlights\n\n- later ^bk-p9-0-4\n\n## Thoughts\n\nmine\n";

  it("inserts in reading order", () => {
    const next = withBookHighlight(page, "early", p(2, 0, 5));
    expect(next).toContain("## Highlights\n\n- early ^bk-p2-0-5\n- later ^bk-p9-0-4\n");
  });

  it("appends after the last one", () => {
    const next = withBookHighlight(page, "end", p(12, 0, 3));
    expect(next).toContain("- later ^bk-p9-0-4\n- end ^bk-p12-0-3\n\n## Thoughts");
  });

  it("adds no heading: the first goes at the end of the page, lines joined", () => {
    expect(withBookHighlight("my notes\n", "a\nb", p(1, 0, 3))).toBe(
      "my notes\n\n- a b ^bk-p1-0-3\n",
    );
    expect(withBookHighlight("", "a", p(1, 0, 1))).toBe("- a ^bk-p1-0-1\n");
  });

  it("follows the last highlight and its children, wherever the writer keeps them", () => {
    const body = "- one ^bk-p1-0-3\n    - my note\n\nthoughts\n";
    expect(withBookHighlight(body, "two", p(2, 0, 3))).toBe(
      "- one ^bk-p1-0-3\n    - my note\n- two ^bk-p2-0-3\n\nthoughts\n",
    );
  });

  it("is idempotent", () => {
    expect(withBookHighlight(page, "later", p(9, 0, 4))).toBe(page);
  });
});

describe("withoutBookHighlight", () => {
  it("removes the bullet and its children", () => {
    const body = "## Highlights\n\n- a ^bk-p1-0-1\n    - my note\n- b ^bk-p2-0-1\n";
    expect(withoutBookHighlight(body, "bk-p1-0-1")).toBe("## Highlights\n\n- b ^bk-p2-0-1\n");
  });
});

describe("pages", () => {
  it("lists reader highlights in order, skipping Apple Books ones", () => {
    const body = "- x ^bk-s2-5-9\n- y ^bk-0123456789ab\n- z ^bk-s0-1-2\n";
    expect(bookHighlightsIn(body).map((h) => h.id)).toEqual(["bk-s0-1-2", "bk-s2-5-9"]);
  });

  it("writes and reads the Book file", () => {
    const { frontmatter, body } = parseFrontmatter(newBookNote("Atomic Habits.pdf", "James Clear"));
    expect(bookFileOf(frontmatter)).toBe("Atomic Habits.pdf");
    expect(authorOf(frontmatter)).toBe("James Clear");
    expect(frontmatter).toContain("Type: Book");
    expect(body.trim()).toBe("");
  });
});

describe("cleanBookTitle", () => {
  it("drops download-site tags", () => {
    expect(cleanBookTitle("Atomic Habits (z-library.sk, 1lib.sk, z-lib.sk)")).toBe("Atomic Habits");
    expect(cleanBookTitle("Deep Work [Z-Library] (2016)")).toBe("Deep Work (2016)");
    expect(cleanBookTitle("Range z-lib.sk")).toBe("Range");
    expect(cleanBookTitle("Thinking, Fast and Slow (Kahneman)")).toBe(
      "Thinking, Fast and Slow (Kahneman)",
    );
  });
});

describe("authors", () => {
  test("reads the author from a download's file name", () => {
    expect(
      authorFromFileName(
        "Skip the Line (James Altucher James Altucher ) (z-library.sk, 1lib.sk, z-lib.sk)",
      ),
    ).toBe("James Altucher");
    expect(
      authorFromFileName("Dads Guide (Matthew M. Miller, Sharon Perkins RN) (Z-Library)"),
    ).toBe("Matthew M. Miller, Sharon Perkins RN");
    expect(authorFromFileName("Deep Work (2016)")).toBeNull();
    expect(authorFromFileName("Deep Work")).toBeNull();
  });

  test("matches the same people whatever the order or punctuation", () => {
    expect(sameAuthor("James Altucher", "Altucher, James")).toBe(true);
    expect(sameAuthor("James Clear", "james clear")).toBe(true);
    expect(sameAuthor("Matthew M. Miller", "Matthew M. Miller, Sharon Perkins")).toBe(true);
    expect(sameAuthor("James Clear", "James Altucher")).toBe(false);
  });
});

describe("toWordEdges", () => {
  test("widens a selection to whole words", async () => {
    const { toWordEdges } = await import("../src/components/book-reader/reader-controller");
    const text = "Habits are the compound interest of self-improvement.";
    const s = text.indexOf("ound");
    expect(text.slice(...toWordEdges(text, s, text.indexOf("inter") + 5))).toBe(
      "compound interest",
    );
    expect(text.slice(...toWordEdges(text, text.indexOf("self") + 2, text.length - 4))).toBe(
      "self-improvement",
    );
    expect(text.slice(...toWordEdges(text, 0, 6))).toBe("Habits");
  });
});

describe("speechLanguage", () => {
  test("voices a word in its script's language", async () => {
    const { speechLanguage } = await import("../src/lib/speak");
    expect(speechLanguage("ephemeral")).toBe("en-US");
    expect(speechLanguage("鬼谷子")).toBe("zh-CN");
    expect(speechLanguage("ありがとう")).toBe("ja-JP");
    expect(speechLanguage("안녕")).toBe("ko-KR");
  });
});
