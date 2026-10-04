import { describe, expect, it } from "vite-plus/test";
import { GRID_STEP, gridSpec } from "../src/components/editor-area/board/board-grid";

describe("gridSpec", () => {
  it("uses the base step when it is wide enough", () => {
    const s = gridSpec(1);
    expect(s.spacing).toBe(GRID_STEP);
    expect(s.coarse).toBe(GRID_STEP * 4);
    expect(s.fineAlpha).toBe(1);
  });

  it("fades the fine level out as it closes up, instead of dropping the grid", () => {
    expect(gridSpec(15 / GRID_STEP).fineAlpha).toBeCloseTo(0.5);
    expect(gridSpec(10 / GRID_STEP).fineAlpha).toBe(0);
  });

  it("steps to the next level below 10px, where the old coarse dots carry on", () => {
    // 9.6px base spacing -> 38.4px fine (the previous coarse), fully visible.
    const s = gridSpec(0.4);
    expect(s.spacing).toBeCloseTo(38.4);
    expect(s.fineAlpha).toBe(1);
  });

  it("always shows some grid down to the minimum zoom", () => {
    const s = gridSpec(0.1);
    expect(s.spacing).toBeGreaterThanOrEqual(10);
    expect(s.spacing).toBeLessThan(40);
  });
});
