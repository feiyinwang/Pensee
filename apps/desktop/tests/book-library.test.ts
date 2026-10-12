import { describe, expect, test, vi } from "vite-plus/test";

const store = new Map<string, unknown>();
vi.mock("../src/lib/preferences", () => ({
  getPreference: async (key: string, fallback: unknown) => store.get(key) ?? fallback,
  setPreference: async (key: string, value: unknown) => void store.set(key, value),
}));

const { forgetBook, listBooks, rememberBook } = await import("../src/lib/book-library");

describe("book library", () => {
  test("keeps one entry per file, newest first, per workspace", async () => {
    await Promise.all([
      rememberBook("/v", { book: "/v/a.pdf", note: "/v/a.md", title: "a" }),
      rememberBook("/v", { book: "/v/b.epub", note: null, title: "b" }),
    ]);
    await rememberBook("/v", { book: "/v/a.pdf", note: null, title: "a" });
    const books = await listBooks("/v");
    expect(books.map((b) => b.book)).toEqual(["/v/a.pdf", "/v/b.epub"]);
    expect(books[0]!.note).toBe("/v/a.md"); // a known page is not forgotten
    expect(await listBooks("/other")).toEqual([]);
    await forgetBook("/v", "/v/b.epub");
    expect((await listBooks("/v")).map((b) => b.book)).toEqual(["/v/a.pdf"]);
  });
});
