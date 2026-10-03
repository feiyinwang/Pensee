import { describe, expect, test } from "vite-plus/test";
import { TEMPLATES } from "../src/components/editor-area/board/board-templates";
import {
  emptyScene,
  parseBoard,
  serializeBoard,
} from "../src/components/editor-area/board/board-model";

describe("board templates", () => {
  for (const t of TEMPLATES) {
    test(`${t.name} builds and round-trips through the file format`, () => {
      const els = t.build();
      expect(els.length).toBeGreaterThan(1);
      expect(new Set(els.map((e) => e.id)).size).toBe(els.length);
      const scene = emptyScene();
      scene.els = els;
      const back = parseBoard(serializeBoard(scene));
      expect(back.badLines).toBe(0);
      expect(back.scene.els).toHaveLength(els.length);
    });
  }

  test("section contents point at a section in the same template", () => {
    for (const t of TEMPLATES) {
      const els = t.build();
      const frames = new Set(els.filter((e) => e.t === "frame").map((e) => e.id));
      for (const el of els) if (el.fr) expect(frames.has(el.fr)).toBe(true);
    }
  });
});
