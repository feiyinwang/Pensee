import { describe, expect, test } from "vite-plus/test";
import { DOCK_SPEC, trayFits } from "../src/components/editor-area/board/board-dock-items";

describe("board tool dock", () => {
  test("every group's tray fits the Dock's outline", () => {
    expect(trayFits(DOCK_SPEC)).toBe(true);
  });

  test("a tray one item too wide is caught", () => {
    const tooWide = DOCK_SPEC.map((s) =>
      s.id === "stickies" ? { ...s, items: [...(s.items ?? []), ...(s.items ?? [])] } : s,
    );
    expect(trayFits(tooWide)).toBe(false);
  });
});
