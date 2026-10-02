import { describe, expect, test } from "vite-plus/test";
import { assignPageSlots, type PageSlot } from "../src/lib/stacked-page-slots";

function ids() {
  let n = 0;
  return () => `s${++n}`;
}

const strip = (slots: PageSlot[]) => slots.map(({ slot, path }) => `${slot}:${path}`);

describe("assignPageSlots", () => {
  test("first assignment creates a slot per page", () => {
    const slots = assignPageSlots([], null, ["/a", "/b"], "/b", ids());
    expect(strip(slots)).toEqual(["s1:/a", "s2:/b"]);
    expect(slots.every((s) => s.fresh)).toBe(true);
  });

  test("navigating a single page reuses its slot", () => {
    const next = ids();
    const first = assignPageSlots([], null, ["/a"], "/a", next);
    const second = assignPageSlots(first, "/a", ["/b"], "/b", next);
    expect(strip(second)).toEqual(["s1:/b"]);
    expect(second[0]!.fresh).toBe(false);
  });

  test("opening a column keeps existing slots and appends a fresh one", () => {
    const next = ids();
    const first = assignPageSlots([], null, ["/a", "/c"], "/a", next);
    const second = assignPageSlots(first, "/a", ["/a", "/b", "/c"], "/b", next);
    // DOM order is creation order; the visual order comes from CSS `order`.
    expect(strip(second)).toEqual(["s1:/a", "s2:/c", "s3:/b"]);
    expect(second.map((s) => s.fresh)).toEqual([false, false, true]);
  });

  test("a reorder keeps every slot", () => {
    const next = ids();
    const first = assignPageSlots([], null, ["/a", "/b"], "/a", next);
    expect(strip(assignPageSlots(first, "/a", ["/b", "/a"], "/a", next))).toEqual([
      "s1:/a",
      "s2:/b",
    ]);
  });

  test("collapsing a stack hands the focused page's slot to the new page", () => {
    const next = ids();
    const first = assignPageSlots([], null, ["/a", "/b", "/c"], "/b", next);
    expect(strip(assignPageSlots(first, "/b", ["/z"], "/z", next))).toEqual(["s2:/z"]);
  });

  test("restoring a stack gives the old slot to the page taking focus", () => {
    const next = ids();
    const first = assignPageSlots([], null, ["/z"], "/z", next);
    const second = assignPageSlots(first, "/z", ["/a", "/b"], "/b", next);
    expect(strip(second)).toEqual(["s1:/b", "s2:/a"]);
  });
});
