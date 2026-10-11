import { describe, expect, test, vi } from "vite-plus/test";
import {
  bookPageNames,
  highlightBlockId,
  highlightMarkdown,
  mergeBook,
  newBookPage,
  syncAppleBooks,
  withBookTag,
  type AppleBooksSyncDeps,
} from "../src/lib/apple-books";
import type { AppleBook, AppleBookHighlight } from "../src/types/apple-books";

function highlight(id: string, text: string, note: string | null = null): AppleBookHighlight {
  return { id, text, note, createdAt: 0 };
}

const book: AppleBook = {
  assetId: "1",
  title: "Atomic Habits: An Easy & Proven Way",
  author: "James Clear",
  highlights: [
    highlight("AAAA1111-2222-3333-4444-555566667777", "Small habits\nadd up."),
    highlight("BBBB1111-2222-3333-4444-555566667777", "Identity first.", "Ties to my notes"),
  ],
};

describe("naming", () => {
  test("a book goes by its full title, then the title before its subtitle", () => {
    expect(bookPageNames(book.title)).toEqual([
      "Atomic Habits An Easy & Proven Way",
      "Atomic Habits",
    ]);
    expect(bookPageNames("Dune")).toEqual(["Dune"]);
  });

  test("a highlight's block id comes from its Apple Books id", () => {
    expect(highlightBlockId(book.highlights[0]!)).toBe("bk-aaaa11112222");
  });
});

describe("highlight markdown", () => {
  test("joins paragraphs into one bullet with the id, note as a child", () => {
    expect(highlightMarkdown(book.highlights[0]!)).toBe("- Small habits add up. ^bk-aaaa11112222");
    expect(highlightMarkdown(book.highlights[1]!)).toBe(
      "- Identity first. ^bk-bbbb11112222\n    - Ties to my notes",
    );
  });

  test("escapes a leading marker that would change the bullet", () => {
    expect(highlightMarkdown(highlight("c", "# not a heading"))).toBe("- \\# not a heading ^bk-c");
    expect(highlightMarkdown(highlight("c", "1. not a list"))).toBe("- \\1. not a list ^bk-c");
  });
});

describe("withBookTag", () => {
  test("adds tags to a page without frontmatter", () => {
    expect(withBookTag(null)).toBe("tags:\n  - Book");
  });

  test("appends a tags key without touching the rest", () => {
    expect(withBookTag("title: X  # keep\nauthor: Y")).toBe(
      "title: X  # keep\nauthor: Y\ntags:\n  - Book",
    );
  });

  test("adds Book to an existing list, once", () => {
    expect(withBookTag("tags:\n  - reading")).toBe("tags:\n  - reading\n  - Book");
    expect(withBookTag("tags: [reading, book]")).toBe("tags: [reading, book]");
    expect(withBookTag("tags: reading")).toBe("tags:\n  - reading\n  - Book");
  });

  test("leaves unreadable frontmatter alone", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(withBookTag("tags: [unclosed")).toBe("tags: [unclosed");
  });
});

describe("mergeBook", () => {
  test("appends a Highlights section to an existing page", () => {
    const merged = mergeBook({ frontmatter: null, body: "# Atomic Habits\n\nMy review.\n" }, book);
    expect(merged.added).toBe(2);
    expect(merged.frontmatter).toBe("tags:\n  - Book");
    expect(merged.body).toBe(
      "# Atomic Habits\n\nMy review.\n\n## Highlights\n\n" +
        "- Small habits add up. ^bk-aaaa11112222\n" +
        "- Identity first. ^bk-bbbb11112222\n    - Ties to my notes\n",
    );
  });

  test("adds only new highlights, at the end of the Highlights section", () => {
    const body =
      "# A\n\n## Highlights\n\n- edited by me ^bk-aaaa11112222\n\n## Thoughts\n\nMine.\n";
    const merged = mergeBook({ frontmatter: "tags:\n  - Book", body }, book);
    expect(merged.added).toBe(1);
    expect(merged.frontmatter).toBe("tags:\n  - Book");
    expect(merged.body).toBe(
      "# A\n\n## Highlights\n\n- edited by me ^bk-aaaa11112222\n" +
        "- Identity first. ^bk-bbbb11112222\n    - Ties to my notes\n\n## Thoughts\n\nMine.\n",
    );
  });

  test("is a no-op once everything is in", () => {
    const first = mergeBook({ frontmatter: null, body: "" }, book);
    const again = mergeBook(first, book);
    expect(again).toEqual({ ...first, added: 0 });
  });
});

describe("newBookPage", () => {
  test("is tagged, credited and titled", () => {
    expect(newBookPage(book, "Atomic Habits")).toBe(
      '---\ntags:\n  - Book\nauthor: "James Clear"\n---\n# Atomic Habits\n\n## Highlights\n\n' +
        "- Small habits add up. ^bk-aaaa11112222\n" +
        "- Identity first. ^bk-bbbb11112222\n    - Ties to my notes\n",
    );
  });
});

describe("syncAppleBooks", () => {
  function deps(pages: Record<string, string>): AppleBooksSyncDeps & { created: string[] } {
    const created: string[] = [];
    return {
      created,
      readHighlights: async () => [book, { ...book, assetId: "2", title: "Dune", highlights: [] }],
      findPage: async (name) => pages[name] ?? null,
      newPagePath: (name) => `/vault/Books/${name}.md`,
      createPage: async (path) => {
        created.push(path);
      },
      editPage: vi.fn(async (_path, edit) => {
        edit({ frontmatter: null, body: "" });
      }),
      isCurrent: () => true,
    };
  }

  test("creates a page under the short title when no page matches", async () => {
    const d = deps({});
    const result = await syncAppleBooks(d);
    expect(d.created).toEqual(["/vault/Books/Atomic Habits.md"]);
    expect(result).toEqual({ pagesCreated: 1, highlightsAdded: 2, failures: [] });
  });

  test("merges into a page that has the book's name", async () => {
    const d = deps({ "Atomic Habits": "/vault/Atomic Habits.md" });
    const result = await syncAppleBooks(d);
    expect(d.created).toEqual([]);
    expect(d.editPage).toHaveBeenCalledWith("/vault/Atomic Habits.md", expect.any(Function));
    expect(result).toEqual({ pagesCreated: 0, highlightsAdded: 2, failures: [] });
  });

  test("reports a failing book and carries on", async () => {
    const d = deps({});
    d.createPage = async () => {
      throw new Error("disk full");
    };
    const result = await syncAppleBooks(d);
    expect(result.failures).toEqual(["Atomic Habits: An Easy & Proven Way: disk full"]);
  });

  test("stops when the workspace changes", async () => {
    const d = deps({});
    d.isCurrent = () => false;
    expect((await syncAppleBooks(d)).pagesCreated).toBe(0);
  });
});
