import { describe, expect, test } from "vite-plus/test";
import {
  MAX_THICKNESS,
  MIN_THICKNESS,
  bookLength,
  bookThickness,
  pageCount,
} from "../src/lib/books";
import type { TypedNote } from "../src/lib/tauri";

function note(properties: Record<string, string>): TypedNote {
  return {
    path: "/vault/Book.md",
    relative_path: "Book.md",
    name: "Book",
    title: null,
    note_type: "Book",
    modified_at: 0,
    properties,
    excerpt: null,
  };
}

describe("pageCount", () => {
  test.each([
    [{ pages: "320" }, 320],
    [{ pages: "320 pages" }, 320],
    [{ pages: "" }, null],
    [{ pages: "many" }, null],
    [{ pages: "0" }, null],
    [{}, null],
  ])("%j → %s", (properties, expected) => {
    expect(pageCount(note(properties))).toBe(expected);
  });
});

describe("bookThickness", () => {
  test("grows with the page count", () => {
    expect(bookThickness(note({ pages: "200" }), "A")).toBe(37);
    expect(bookThickness(note({ pages: "480" }), "A")).toBe(54);
  });

  test("stays within the spine limits", () => {
    expect(bookThickness(note({ pages: "12" }), "A")).toBe(MIN_THICKNESS);
    expect(bookThickness(note({ pages: "2400" }), "A")).toBe(MAX_THICKNESS);
  });

  test("without a page count, the title picks it and keeps it", () => {
    const first = bookThickness(note({}), "Working in Public");
    expect(bookThickness(note({}), "Working in Public")).toBe(first);
    expect(first).toBeGreaterThanOrEqual(MIN_THICKNESS);
    expect(first).toBeLessThanOrEqual(MAX_THICKNESS);
  });
});

describe("bookLength", () => {
  test("is stable per title and in range", () => {
    for (const title of ["Skip the Line", "The Dream Machine", "Built to Grow", "日本語"]) {
      const length = bookLength(title);
      expect(bookLength(title)).toBe(length);
      expect(length).toBeGreaterThanOrEqual(560);
      expect(length).toBeLessThanOrEqual(624);
    }
  });
});
