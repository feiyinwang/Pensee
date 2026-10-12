import { describe, expect, it } from "vite-plus/test";

import {
  bookFileOf,
  bookHighlightId,
  bookHighlightsIn,
  newBookNote,
  parseBookHighlightId,
  withBookHighlight,
  withoutBookHighlight,
} from "../src/lib/book-highlights";
import { parseFrontmatter } from "../src/lib/frontmatter";

const p = (section: number, start: number, end: number) =>
  ({ unit: "p", section, start, end }) as const;

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
    const { frontmatter, body } = parseFrontmatter(newBookNote("Atomic Habits.pdf"));
    expect(bookFileOf(frontmatter)).toBe("Atomic Habits.pdf");
    expect(frontmatter).toContain("Type: Book");
    expect(body.trim()).toBe("");
  });
});
