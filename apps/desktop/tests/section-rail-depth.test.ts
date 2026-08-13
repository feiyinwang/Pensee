import { describe, expect, test } from "vite-plus/test";
import {
  DEPTH_WINDOW,
  INDENT_STEP,
  TICK_MAX_WIDTH,
  TICK_WIDTH_BY_DEPTH,
  indentForDepth,
  nextWindowStart,
  tickWidthForDepth,
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

describe("tickWidthForDepth", () => {
  test("shallower headings get wider ticks", () => {
    const widths = [0, 1, 2, 3, 4, 5].map(tickWidthForDepth);
    expect(widths).toEqual(TICK_WIDTH_BY_DEPTH);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1]);
  });

  test("never exceeds the pre-existing 20px rail width", () => {
    expect(TICK_MAX_WIDTH).toBe(20);
    for (const depth of [0, 1, 2, 3, 4, 5, 6, 20]) {
      expect(tickWidthForDepth(depth)).toBeLessThanOrEqual(TICK_MAX_WIDTH);
    }
  });

  test("clamps past the end of the table instead of returning undefined", () => {
    expect(tickWidthForDepth(99)).toBe(TICK_WIDTH_BY_DEPTH[TICK_WIDTH_BY_DEPTH.length - 1]);
  });
});
