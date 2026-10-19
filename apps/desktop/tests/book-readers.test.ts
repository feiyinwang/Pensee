import { afterEach, describe, expect, it } from "vite-plus/test";

import { type OpenReader, bookPlaceName, registerReader } from "../src/lib/book-readers";

const reader = (notePath: string, titles: string[]): OpenReader => ({
  bookPath: `${notePath}.epub`,
  notePath,
  passage: async () => null,
  jump: () => true,
  sectionTitle: (section) => titles[section] ?? null,
});

const s = (section: number) => ({ unit: "s", section, start: 0, end: 5 }) as const;

describe("bookPlaceName", () => {
  let unregister: (() => void) | null = null;
  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  it("names the place by number while the book is closed", () => {
    expect(bookPlaceName("Style.md", s(2))).toBe("section 3");
    expect(bookPlaceName("Style.md", { unit: "p", section: 24, start: 0, end: 5 })).toBe("page 24");
  });

  it("names an EPUB section by its chapter while the book is open", () => {
    unregister = registerReader(reader("Style.md", ["Introductory", "Elementary Rules"]));
    expect(bookPlaceName("Style.md", s(1))).toBe("Elementary Rules");
    // Another page's book doesn't name this one's places.
    expect(bookPlaceName("Other.md", s(1))).toBe("section 2");
    // A section the book has no title for falls back to its number.
    expect(bookPlaceName("Style.md", s(9))).toBe("section 10");
  });
});
