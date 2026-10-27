import { describe, expect, test } from "vite-plus/test";
import { mermaidToElements } from "../src/components/editor-area/board/board-mermaid";
import { type BoardScene, emptyScene } from "../src/components/editor-area/board/board-model";
import type { MindEl } from "../src/components/editor-area/board/board-model";
import { mergeTopicBoard, mindmapText } from "../src/lib/talk/topic-board-merge";

const measure = (text: string, size: number) => text.length * size * 0.55;

const board = (mermaid: string): BoardScene => {
  const scene = emptyScene();
  scene.els = mermaidToElements(mermaid, measure)!;
  return scene;
};
const els = (mermaid: string) => mermaidToElements(mermaid, measure)!;

/** The tree as "parent > child" lines, in scene order. */
const tree = (scene: BoardScene) => {
  const minds = scene.els.filter((e): e is MindEl => e.t === "mind");
  const text = new Map(minds.map((m) => [m.id, m.tx]));
  return minds.filter((m) => m.pa).map((m) => `${text.get(m.pa!)} > ${m.tx}`);
};

const FIRST = `mindmap
  root((My business idea))
    Scan keywords
    Use Rob's skills
    Test with ads`;

describe("topic board merge", () => {
  test("untouched topics follow the AI's new tree: ads move under Rob's skills", () => {
    const written = board(FIRST);
    const file = structuredClone(written);
    const next = els(`mindmap
  root((My business idea))
    Scan keywords
    Use Rob's skills
      Test with ads`);
    const { scene, frozen } = mergeTopicBoard(file, written, next, measure);
    expect(frozen).toBe(false);
    expect(tree(scene)).toEqual([
      "My business idea > Scan keywords",
      "My business idea > Use Rob's skills",
      "Use Rob's skills > Test with ads",
    ]);
  });

  test("a topic you moved by hand stays where you put it", () => {
    const written = board(FIRST);
    const file = structuredClone(written);
    const minds = file.els as MindEl[];
    const ads = minds.find((m) => m.tx === "Test with ads")!;
    const scan = minds.find((m) => m.tx === "Scan keywords")!;
    ads.pa = scan.id;
    delete ads.c;
    // The AI still draws ads at the top level, and adds a branch.
    const next = els(`mindmap
  root((My business idea))
    Scan keywords
    Use Rob's skills
    Test with ads
    Pick the best idea`);
    const { scene } = mergeTopicBoard(file, written, next, measure);
    expect(tree(scene)).toContain("Scan keywords > Test with ads");
    expect(tree(scene)).toContain("My business idea > Pick the best idea");
  });

  test("words you changed and topics you deleted are kept that way", () => {
    const written = board(FIRST);
    const file = structuredClone(written);
    const minds = file.els as MindEl[];
    minds.find((m) => m.tx === "Scan keywords")!.tx = "Scan keywords worldwide";
    file.els = file.els.filter((e) => (e as MindEl).tx !== "Test with ads");
    const next = els(FIRST);
    const { scene } = mergeTopicBoard(file, written, next, measure);
    expect(tree(scene)).toEqual([
      "My business idea > Scan keywords worldwide",
      "My business idea > Use Rob's skills",
    ]);
  });

  test("what the AI drew and then dropped goes, unless it holds something of yours", () => {
    const written = board(FIRST);
    const file = structuredClone(written);
    const rob = (file.els as MindEl[]).find((m) => m.tx === "Use Rob's skills")!;
    file.els.push({ ...rob, id: "mine0001", tx: "My own note", pa: rob.id, c: undefined });
    const next = els(`mindmap
  root((My business idea))
    Scan keywords`);
    const { scene } = mergeTopicBoard(file, written, next, measure);
    expect(tree(scene)).toEqual([
      "My business idea > Scan keywords",
      "My business idea > Use Rob's skills",
      "Use Rob's skills > My own note",
    ]);
  });

  test("children you put in another order keep your order", () => {
    const written = board(FIRST);
    const file = structuredClone(written);
    const ads = file.els.findIndex((e) => (e as MindEl).tx === "Test with ads");
    const [moved] = file.els.splice(ads, 1);
    file.els.splice(1, 0, moved!);
    const { scene } = mergeTopicBoard(file, written, els(FIRST), measure);
    expect(tree(scene)).toEqual([
      "My business idea > Test with ads",
      "My business idea > Scan keywords",
      "My business idea > Use Rob's skills",
    ]);
  });

  test("a flowchart you edited is left as it is", () => {
    const flow = "flowchart LR\n  A[Keywords] --> B[Ideas]";
    const written = board(flow);
    const file = structuredClone(written);
    file.els[0] = { ...file.els[0], x: file.els[0].x + 50, c: "red" } as never;
    const { scene, frozen } = mergeTopicBoard(
      file,
      written,
      els("flowchart LR\n  A[Keywords] --> B[Ideas] --> C[Test]"),
      measure,
    );
    expect(frozen).toBe(true);
    expect(scene).toBe(file);
  });

  test("the board's mind map goes back to the AI as Mermaid", () => {
    expect(mindmapText(board(FIRST))).toBe(
      "mindmap\n  root((My business idea))\n    Scan keywords\n    Use Rob's skills\n    Test with ads",
    );
  });
});
