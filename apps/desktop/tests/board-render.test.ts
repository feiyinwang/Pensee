import { describe, expect, test } from "vite-plus/test";
import { LINE_HEIGHT, centredTop } from "../src/components/editor-area/board/board-render";

describe("centredTop", () => {
  test("centres the line boxes themselves, not the gap under the last line", () => {
    const size = 14;
    const top = centredTop(100, 1, size, 10);
    expect(top + (size * LINE_HEIGHT) / 2).toBeCloseTo(50);
  });

  test("never starts above the padding when the text overflows", () => {
    expect(centredTop(40, 6, 14, 10)).toBe(10);
  });
});
