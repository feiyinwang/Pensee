import { describe, expect, test } from "vite-plus/test";
import {
  cleanPageTitle,
  fallbackLinkTitle,
  findLibraryNote,
  libraryKindOfTab,
  libraryNoteContent,
  libraryNoteType,
  parseLibraryLink,
  pdfKind,
  sourceKey,
  withLibraryType,
} from "../src/lib/library-add";
import type { TypedNote } from "../src/lib/tauri";

function note(path: string, properties: Record<string, string>, note_type = "YouTube"): TypedNote {
  return {
    path,
    relative_path: path.replace("/vault/", ""),
    name: path.split("/").pop()!.replace(/\.md$/, ""),
    title: null,
    note_type,
    modified_at: 0,
    properties,
    excerpt: null,
  };
}

describe("parseLibraryLink", () => {
  test.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube.com", "video"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtu.be", "video"],
    ["https://vimeo.com/76979871", "vimeo.com", "video"],
    ["https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk", "open.spotify.com", "podcast"],
    ["https://podcasts.apple.com/us/podcast/x/id123", "podcasts.apple.com", "podcast"],
    ["https://arxiv.org/abs/1706.03762", "arxiv.org", "paper"],
    ["https://doi.org/10.1145/3290605.3300233", "doi.org", "paper"],
    ["https://dl.acm.org/doi/10.1145/3290605.3300233", "dl.acm.org", "paper"],
    ["https://www.coursera.org/learn/machine-learning", "coursera.org", "course"],
    ["https://www.goodreads.com/book/show/11468377", "goodreads.com", "book"],
    ["https://www.amazon.com/dp/0374533555", "amazon.com", "book"],
    ["youtube.com/watch?v=dQw4w9WgXcQ", "youtube.com", "video"],
  ])("%s → %s, %s", (query, host, guess) => {
    expect(parseLibraryLink(query)).toMatchObject({ host, guess });
  });

  test("an unknown site has no guess", () => {
    expect(parseLibraryLink("https://someblog.substack.com/p/on-writing")?.guess).toBeNull();
  });

  test("a spotify track or playlist is not a podcast", () => {
    expect(parseLibraryLink("https://open.spotify.com/track/abc")?.guess).toBeNull();
  });

  test.each(["", "Thinking, Fast and Slow", "see https://youtu.be/dQw4w9WgXcQ", "notes.md"])(
    "%j is not a link",
    (query) => expect(parseLibraryLink(query)).toBeNull(),
  );
});

describe("sourceKey", () => {
  test("every YouTube address of one video is one source", () => {
    const keys = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    ].map(sourceKey);
    expect(new Set(keys)).toEqual(new Set(["youtube:dQw4w9WgXcQ"]));
  });

  test("arXiv abstract and PDF, any version, are one paper", () => {
    expect(sourceKey("https://arxiv.org/abs/1706.03762v7")).toBe("arxiv:1706.03762");
    expect(sourceKey("https://arxiv.org/pdf/1706.03762")).toBe("arxiv:1706.03762");
  });

  test("a DOI is found in any publisher's path", () => {
    expect(sourceKey("https://doi.org/10.1145/3290605.3300233")).toBe(
      "doi:10.1145/3290605.3300233",
    );
    expect(sourceKey("https://dl.acm.org/doi/10.1145/3290605.3300233")).toBe(
      "doi:10.1145/3290605.3300233",
    );
  });

  test("other links drop scheme, www, tracking and trailing slash", () => {
    expect(sourceKey("https://www.coursera.org/learn/ml/?utm_source=x")).toBe(
      sourceKey("http://coursera.org/learn/ml"),
    );
  });
});

describe("findLibraryNote", () => {
  const notes = [
    note("/vault/Rick.md", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    note("/vault/Attention.md", { link: "https://arxiv.org/abs/1706.03762" }, "Paper"),
    note("/vault/Plain.md", {}),
    note("/vault/HCI.md", { doi: "10.1145/3290605.3300233" }, "Paper"),
  ];

  test("finds the note under another address of the same source", () => {
    expect(findLibraryNote(notes, "https://youtu.be/dQw4w9WgXcQ")?.path).toBe("/vault/Rick.md");
    expect(findLibraryNote(notes, "https://arxiv.org/pdf/1706.03762v2")?.path).toBe(
      "/vault/Attention.md",
    );
  });

  test("a paper's bare DOI property matches its DOI link", () => {
    expect(findLibraryNote(notes, "https://dl.acm.org/doi/10.1145/3290605.3300233")?.path).toBe(
      "/vault/HCI.md",
    );
  });

  test("null for a new source", () => {
    expect(findLibraryNote(notes, "https://youtu.be/aaaaaaaaaaa")).toBeNull();
  });
});

describe("new notes", () => {
  test("YouTube links keep the vault's YouTube type; other videos are Video", () => {
    expect(libraryNoteType("video", "youtube.com")).toBe("YouTube");
    expect(libraryNoteType("video", "youtu.be")).toBe("YouTube");
    expect(libraryNoteType("video", "vimeo.com")).toBe("Video");
    expect(libraryNoteType("paper", "arxiv.org")).toBe("Paper");
  });

  test("properties only: type and link", () => {
    expect(libraryNoteContent("YouTube", "https://youtu.be/dQw4w9WgXcQ")).toBe(
      "---\nType: YouTube\nLink: https://youtu.be/dQw4w9WgXcQ\n---\n",
    );
    expect(libraryNoteContent("Book", null)).toBe("---\nType: Book\n---\n");
  });

  test("a link with no title is named by its host and id", () => {
    expect(fallbackLinkTitle(parseLibraryLink("https://youtu.be/dQw4w9WgXcQ")!)).toBe(
      "youtu.be dQw4w9WgXcQ",
    );
    expect(fallbackLinkTitle(parseLibraryLink("https://arxiv.org/abs/1706.03762")!)).toBe(
      "arxiv.org 1706.03762",
    );
  });

  test("page titles lose the site's name and arXiv's id", () => {
    expect(cleanPageTitle("Never Gonna Give You Up - YouTube", "YouTube")).toBe(
      "Never Gonna Give You Up",
    );
    expect(cleanPageTitle("[1706.03762] Attention Is All You Need", "arXiv.org")).toBe(
      "Attention Is All You Need",
    );
    expect(cleanPageTitle("Machine Learning | Coursera", null)).toBe("Machine Learning");
  });

  test("a Library tab's kind", () => {
    expect(libraryKindOfTab("books")).toBe("book");
    expect(libraryKindOfTab("videos")).toBe("video");
    expect(libraryKindOfTab("bookmarks")).toBeNull();
  });
});

describe("pdfKind", () => {
  test("an ISBN makes a book, whatever else", () => {
    expect(pdfKind({ pages: 12, text: "Abstract ... ISBN 978-0-374-53355-7" })).toBe("book");
  });
  test("an arXiv id makes a paper", () => {
    expect(pdfKind({ pages: 90, text: "arXiv:1706.03762v7 [cs.CL]" })).toBe("paper");
  });
  test("an abstract on a short file makes a paper", () => {
    expect(pdfKind({ pages: 14, text: "Abstract The dominant sequence…" })).toBe("paper");
  });
  test("a long file makes a book", () => {
    expect(pdfKind({ pages: 296, text: "Chapter 1" })).toBe("book");
  });
  test("a DOI alone decides nothing", () => {
    expect(pdfKind({ pages: 61, text: "https://doi.org/10.1007/978-3-030-12345-6" })).toBeNull();
  });
});

describe("withLibraryType", () => {
  test("a dropped book page becomes a paper and loses its Book tag", () => {
    const page = "Type: Book\nAuthor: Ashish Vaswani\nBook: attention.pdf\ntags:\n  - Book";
    expect(withLibraryType(page, "Paper")).toBe(
      "Type: Paper\nAuthor: Ashish Vaswani\nBook: attention.pdf",
    );
  });

  test("other tags stay", () => {
    expect(withLibraryType("Type: Book\ntags:\n  - Book\n  - ml", "Paper")).toBe(
      "Type: Paper\ntags:\n  - ml",
    );
  });

  test("a page with no type gets one", () => {
    expect(withLibraryType("Author: X", "Paper")).toBe("Type: Paper\nAuthor: X");
  });

  test("unreadable YAML is left alone", () => {
    expect(withLibraryType("Type: [Book", "Paper")).toBe("Type: [Book");
  });
});
