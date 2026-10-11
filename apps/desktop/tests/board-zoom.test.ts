import { describe, expect, it } from "vite-plus/test";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  boundGestureZoom,
  clampZoom,
  stretchZoom,
} from "../src/components/editor-area/board/board-model";

describe("board zoom limits", () => {
  it("clamps to 10%–500%", () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(1000)).toBe(ZOOM_MAX);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it("leaves zooms inside the limits alone", () => {
    for (const z of [ZOOM_MIN, 0.5, 1, 3, ZOOM_MAX]) expect(stretchZoom(z)).toBe(z);
  });

  it("stretches past a limit, never more than 15%", () => {
    const justOver = stretchZoom(ZOOM_MAX * 1.01);
    expect(justOver).toBeGreaterThan(ZOOM_MAX);
    // Same speed off the edge as onto it: no kink at the limit.
    expect(justOver).toBeCloseTo(ZOOM_MAX * 1.01, 1);
    expect(stretchZoom(ZOOM_MAX * 100)).toBeLessThanOrEqual(ZOOM_MAX * 1.15);
    expect(stretchZoom(ZOOM_MIN / 100)).toBeGreaterThanOrEqual(ZOOM_MIN / 1.15);
    expect(stretchZoom(ZOOM_MAX * 1.3)).toBeGreaterThan(stretchZoom(ZOOM_MAX * 1.1));
  });

  it("bounds a pinch's own zoom so reversing unwinds quickly", () => {
    expect(boundGestureZoom(ZOOM_MAX * 100)).toBeLessThan(ZOOM_MAX * 1.6);
    expect(boundGestureZoom(1)).toBe(1);
  });
});
