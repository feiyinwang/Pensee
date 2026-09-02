import { describe, expect, test } from "vite-plus/test";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, clampZoom, stepZoom } from "../src/lib/zoom";

describe("clampZoom", () => {
  test("falls back to the default for missing or non-numeric values", () => {
    expect(clampZoom(undefined)).toBe(ZOOM_DEFAULT);
    expect(clampZoom("150")).toBe(ZOOM_DEFAULT);
    expect(clampZoom(Number.NaN)).toBe(ZOOM_DEFAULT);
  });

  test("clamps to the supported range and rounds", () => {
    expect(clampZoom(10)).toBe(ZOOM_MIN);
    expect(clampZoom(900)).toBe(ZOOM_MAX);
    expect(clampZoom(124.6)).toBe(125);
  });
});

describe("stepZoom", () => {
  test("walks the ladder from a stop", () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(110, 1)).toBe(125);
    expect(stepZoom(100, -1)).toBe(90);
    expect(stepZoom(175, 1)).toBe(200);
  });

  test("snaps onto the ladder from a value between stops", () => {
    expect(stepZoom(96, 1)).toBe(100);
    expect(stepZoom(96, -1)).toBe(90);
    expect(stepZoom(101, -1)).toBe(100);
  });

  test("stays put at either end", () => {
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  test("reaches 200% from the default in five steps", () => {
    let level = ZOOM_DEFAULT;
    for (let i = 0; i < 5; i++) level = stepZoom(level, 1);
    expect(level).toBe(200);
  });
});
