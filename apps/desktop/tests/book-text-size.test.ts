import { describe, expect, test, vi } from "vite-plus/test";

const store = new Map<string, unknown>();
vi.mock("../src/lib/preferences", () => ({
  getPreference: async (key: string, fallback: unknown) => store.get(key) ?? fallback,
  setPreference: async (key: string, value: unknown) => void store.set(key, value),
}));

const {
  BOOK_TEXT_SIZES,
  DEFAULT_BOOK_TEXT_SIZE,
  bookTextSize,
  saveBookTextSize,
  stepBookTextSize,
} = await import("../src/lib/book-text-size");

describe("book text size", () => {
  test("steps along the ladder and stops at its ends", () => {
    expect(stepBookTextSize(17, 1)).toBe(19);
    expect(stepBookTextSize(17, -1)).toBe(15);
    expect(stepBookTextSize(BOOK_TEXT_SIZES[0], -1)).toBe(BOOK_TEXT_SIZES[0]);
    expect(stepBookTextSize(BOOK_TEXT_SIZES.at(-1)!, 1)).toBe(BOOK_TEXT_SIZES.at(-1));
  });

  test("a size off the ladder steps to its neighbour", () => {
    expect(stepBookTextSize(18, 1)).toBe(19);
    expect(stepBookTextSize(18, -1)).toBe(17);
  });

  test("is one size for every book, 17px until changed", async () => {
    expect(await bookTextSize()).toBe(DEFAULT_BOOK_TEXT_SIZE);
    await saveBookTextSize(21);
    expect(await bookTextSize()).toBe(21);
  });
});
