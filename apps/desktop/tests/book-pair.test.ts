import { describe, expect, test } from "vite-plus/test";

import { bookPair } from "../src/components/editor-area/book-pair";
import type { Tab } from "../src/stores/editor-store";

const tab = (id: string, location: Tab["location"]): Tab => ({
  id,
  location,
  back: [],
  forward: [],
});
const tabs = [
  tab("tab-1", { kind: "file", path: "/v/Other.md" }),
  tab("tab-2", { kind: "book", path: "/v/Atomic Habits.pdf" }),
  tab("tab-3", { kind: "file", path: "/v/Atomic Habits.md" }),
];
const pages = { "/v/Atomic Habits.pdf": "/v/Atomic Habits.md" };

describe("bookPair", () => {
  test("pairs a book with its page from either side, in tab order", () => {
    expect(bookPair(tabs, "tab-2", pages)).toEqual(["tab-2", "tab-3"]);
    expect(bookPair(tabs, "tab-3", pages)).toEqual(["tab-2", "tab-3"]);
  });

  test("falls back to the tab's note hint, and pairs nothing else", () => {
    const hinted = [
      tabs[0]!,
      tab("tab-2", { kind: "book", path: "/v/A.pdf", note: "/v/Other.md" }),
    ];
    expect(bookPair(hinted, "tab-1", {})).toEqual(["tab-1", "tab-2"]);
    expect(bookPair(tabs, "tab-1", pages)).toBeNull();
    expect(bookPair(tabs.slice(0, 2), "tab-2", pages)).toBeNull();
  });
});
