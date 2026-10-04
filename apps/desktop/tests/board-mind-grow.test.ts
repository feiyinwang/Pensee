import { describe, expect, test } from "vite-plus/test";
import type { BoardScene, MindEl } from "../src/components/editor-area/board/board-model";
import {
  growMind,
  layoutMind,
  mindChildren,
  mindDots,
  newMindRoot,
} from "../src/components/editor-area/board/board-mind";

const measure = (text: string, size: number) => text.length * size * 0.55;

function scene(): { s: BoardScene; root: MindEl } {
  const root = newMindRoot({ x: 0, y: 0 }, "Plan");
  const s = { header: { v: 1, vp: { x: 0, y: 0, zoom: 1 }, bg: "dot" }, els: [root] } as BoardScene;
  return { s, root };
}

describe("mind map quick dots", () => {
  test("the root grows branches out of either side, pinned to that side", () => {
    const { s, root } = scene();
    expect(mindDots(s, root)).toEqual({ e: "child", w: "child" });
    const right = growMind(s, root, "e")!;
    const left = growMind(s, root, "w")!;
    layoutMind(s, root.id, measure);
    expect(right.sd).toBe("r");
    expect(left.sd).toBe("l");
    expect(right.x).toBeGreaterThan(root.x + root.w);
    expect(left.x + left.w).toBeLessThan(root.x);
  });

  test("a topic grows a child away from the root and parallel topics above and below", () => {
    const { s, root } = scene();
    const a = growMind(s, root, "w")!;
    layoutMind(s, root.id, measure);
    expect(mindDots(s, a)).toEqual({ w: "child", n: "before", s: "after" });
    const before = growMind(s, a, "n")!;
    const after = growMind(s, a, "s")!;
    const kid = growMind(s, a, "w")!;
    layoutMind(s, root.id, measure);
    expect(mindChildren(s, root.id).map((k) => k.id)).toEqual([before.id, a.id, after.id]);
    // Parallel first-level topics stay on the side they were grown from.
    expect([before.sd, after.sd]).toEqual(["l", "l"]);
    expect(before.y).toBeLessThan(a.y);
    expect(after.y).toBeGreaterThan(a.y);
    expect(kid.pa).toBe(a.id);
    expect(kid.x + kid.w).toBeLessThan(a.x);
  });

  test("no dot on the side the branch arrives from", () => {
    const { s, root } = scene();
    const a = growMind(s, root, "e")!;
    layoutMind(s, root.id, measure);
    expect(growMind(s, a, "w")).toBeNull();
  });
});
