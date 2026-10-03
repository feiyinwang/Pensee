import { describe, expect, test } from "vite-plus/test";
import {
  addMindChild,
  addMindSibling,
  branchColor,
  layoutMind,
  mindChildren,
  mindSubtree,
  newMindRoot,
} from "../src/components/editor-area/board/board-mind";
import {
  mindmapToElements,
  mermaidToElements,
} from "../src/components/editor-area/board/board-mermaid";
import {
  type MindEl,
  emptyScene,
  parseBoard,
  serializeBoard,
} from "../src/components/editor-area/board/board-model";

const measure = (t: string, size: number) => t.length * size * 0.55;

function map() {
  const scene = emptyScene();
  const root = newMindRoot({ x: 0, y: 0 }, "Plan");
  scene.els.push(root);
  const a = addMindChild(scene, root);
  a.tx = "Goals";
  const b = addMindChild(scene, root);
  b.tx = "Risks";
  const a1 = addMindChild(scene, a);
  a1.tx = "Ship v1";
  layoutMind(scene, root.id, measure);
  return { scene, root, a, b, a1 };
}

const centre = (el: MindEl) => ({ x: el.x + el.w / 2, y: el.y + el.h / 2 });

describe("layoutMind", () => {
  test("first-level topics balance across both sides of the root", () => {
    const { root, a, b } = map();
    const sides = [a, b].map((k) => Math.sign(centre(k).x - centre(root).x)).sort();
    expect(sides).toEqual([-1, 1]);
  });

  test("a child grows outward from its parent and is vertically centred on it", () => {
    const { a, a1 } = map();
    const outward = Math.sign(centre(a).x) === Math.sign(centre(a1).x - centre(a).x);
    expect(outward).toBe(true);
    expect(centre(a1).y).toBeCloseTo(centre(a).y, 0);
  });

  test("the root keeps its centre when it is re-measured", () => {
    const { scene, root } = map();
    const before = centre(root);
    root.tx = "A much longer central topic";
    layoutMind(scene, root.id, measure);
    expect(centre(root).x).toBeCloseTo(before.x, 0);
    expect(centre(root).y).toBeCloseTo(before.y, 0);
  });

  test("sibling subtrees never overlap", () => {
    const { scene, root, a } = map();
    for (let i = 0; i < 4; i += 1) addMindChild(scene, a).tx = `Item ${i}`;
    layoutMind(scene, root.id, measure);
    const kids = mindChildren(scene, a.id);
    for (let i = 1; i < kids.length; i += 1) {
      expect(kids[i].y).toBeGreaterThanOrEqual(kids[i - 1].y + kids[i - 1].h);
    }
  });
});

describe("editing", () => {
  test("a sibling lands right after its topic, and on the root it is a child", () => {
    const { scene, root, a, b } = map();
    const s = addMindSibling(scene, a);
    expect(mindChildren(scene, root.id).map((k) => k.id)).toEqual([a.id, s.id, b.id]);
    expect(addMindSibling(scene, root).pa).toBe(root.id);
  });

  test("branches take palette colours and descendants inherit them", () => {
    const { scene, a, a1 } = map();
    expect(branchColor(scene, a)).toBe(a.c);
    expect(branchColor(scene, a1)).toBe(a.c);
  });

  test("a subtree lists its topic and everything below it", () => {
    const { scene, a, a1 } = map();
    expect(mindSubtree(scene, a.id).map((n) => n.id)).toEqual([a.id, a1.id]);
  });

  test("topics round-trip through the file format", () => {
    const { scene } = map();
    const back = parseBoard(serializeBoard(scene)).scene;
    expect(back.els).toEqual(scene.els);
  });
});

describe("Mermaid mindmap import", () => {
  const src = `mindmap
  root((Launch))
    Marketing
      Blog post
      ::icon(fa fa-book)
    [Engineering]
      QA
  `;

  test("indentation becomes the tree and brackets are stripped", () => {
    const els = mindmapToElements(src, measure)! as MindEl[];
    const byText = (t: string) => els.find((e) => e.tx === t)!;
    expect(byText("Launch").pa).toBeUndefined();
    expect(byText("Marketing").pa).toBe(byText("Launch").id);
    expect(byText("Blog post").pa).toBe(byText("Marketing").id);
    expect(byText("Engineering").pa).toBe(byText("Launch").id);
    expect(byText("QA").pa).toBe(byText("Engineering").id);
    expect(els).toHaveLength(5);
  });

  test("the registry picks it up", () => {
    expect(mermaidToElements(src, measure)?.length).toBe(5);
  });
});
