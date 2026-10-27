import { describe, expect, test } from "vite-plus/test";
import {
  DEPTH_WINDOW,
  INDENT_STEP,
  SEGMENT_GAP,
  SEGMENT_MIN,
  dotOffset,
  indentForDepth,
  nextWindowStart,
  segmentLayout,
} from "../src/components/editor-area/section-rail-depth";

describe("indentForDepth", () => {
  test("indents one step per depth inside the window", () => {
    expect([0, 1, 2].map((d) => indentForDepth(d, 0))).toEqual([0, INDENT_STEP, INDENT_STEP * 2]);
  });

  test("flattens rows shallower than the window instead of pushing them negative", () => {
    expect(indentForDepth(0, 2)).toBe(0);
    expect(indentForDepth(1, 2)).toBe(0);
  });

  test("clamps rows deeper than the window so the text column never keeps shrinking", () => {
    expect(indentForDepth(5, 0)).toBe(INDENT_STEP * (DEPTH_WINDOW - 1));
    expect(indentForDepth(9, 0)).toBe(INDENT_STEP * (DEPTH_WINDOW - 1));
  });

  test("max indent stays at 24px so a 260px popover keeps most of its text column", () => {
    expect(INDENT_STEP * (DEPTH_WINDOW - 1)).toBe(24);
  });
});

describe("nextWindowStart", () => {
  test("does not move while the active depth stays inside the window", () => {
    expect(nextWindowStart(0, 0, 5)).toBe(0);
    expect(nextWindowStart(0, 1, 5)).toBe(0);
    expect(nextWindowStart(0, 2, 5)).toBe(0);
  });

  test("slides down only once the active depth falls past the window", () => {
    expect(nextWindowStart(0, 3, 5)).toBe(1);
    expect(nextWindowStart(1, 4, 5)).toBe(2);
  });

  test("slides back up to the active depth when it goes shallower", () => {
    expect(nextWindowStart(3, 1, 5)).toBe(1);
    expect(nextWindowStart(2, 0, 5)).toBe(0);
  });

  test("never leaves a trailing empty tier at the deep end", () => {
    expect(nextWindowStart(9, 5, 5)).toBe(3);
    expect(nextWindowStart(0, 5, 5)).toBe(3);
  });

  test("a doc no deeper than the window never slides", () => {
    for (const active of [0, 1, 2]) expect(nextWindowStart(0, active, 2)).toBe(0);
  });

  test("a flat doc pins the window at 0", () => {
    expect(nextWindowStart(0, 0, 0)).toBe(0);
  });

  test("no active heading resets to 0", () => {
    expect(nextWindowStart(3, null, 5)).toBe(0);
  });
});

describe("segmentLayout", () => {
  const ends = (segs: { top: number; height: number }[]) =>
    segs[segs.length - 1].top + segs[segs.length - 1].height;

  test("fills the track exactly, with a gap between segments", () => {
    const segs = segmentLayout([100, 300, 600], 400);
    expect(ends(segs)).toBeCloseTo(400);
    expect(segs[1].top - (segs[0].top + segs[0].height)).toBe(SEGMENT_GAP);
  });

  test("a longer section gets a longer segment", () => {
    const [a, b, c] = segmentLayout([100, 300, 600], 400);
    expect(a.height).toBeLessThan(b.height);
    expect(b.height).toBeLessThan(c.height);
  });

  test("a one-line section still gets a segment you can hover", () => {
    const segs = segmentLayout([1, 100_000], 400);
    expect(segs[0].height).toBeGreaterThanOrEqual(SEGMENT_MIN);
  });

  test("more headings than fit shrink the gaps and minimum instead of overflowing", () => {
    const segs = segmentLayout(
      Array.from({ length: 100 }, () => 10),
      300,
    );
    expect(ends(segs)).toBeCloseTo(300);
    for (const seg of segs) expect(seg.height).toBeGreaterThan(0);
  });

  test("no headings or no room lays out nothing", () => {
    expect(segmentLayout([], 400)).toEqual([]);
    expect(segmentLayout([10], 0)).toEqual([]);
  });
});

describe("dotOffset", () => {
  const segment = { top: 100, height: 40 };

  test("maps the reading line's place in its section onto that segment", () => {
    expect(dotOffset(segment, 1000, 2000, 1500)).toBe(120);
  });

  test("stays inside the marked segment when the reading line is elsewhere (a pinned click)", () => {
    expect(dotOffset(segment, 1000, 2000, 100)).toBe(100);
    expect(dotOffset(segment, 1000, 2000, 9000)).toBe(140);
  });

  test("an empty section puts the dot at its segment's start", () => {
    expect(dotOffset(segment, 1000, 1000, 1000)).toBe(100);
  });
});
