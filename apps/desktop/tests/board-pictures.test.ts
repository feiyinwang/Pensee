import { describe, expect, test } from "vite-plus/test";
import {
  mermaidToElements,
  pictureToElements,
} from "../src/components/editor-area/board/board-mermaid";
import {
  type BoardEl,
  type ChartEl,
  type FrameEl,
  type ShapeEl,
  emptyScene,
  parseBoard,
  serializeBoard,
} from "../src/components/editor-area/board/board-model";
import { PICTURE_STARTERS } from "../src/components/editor-area/board/board-dock-items";
import { mergeTopicBoard } from "../src/lib/talk/topic-board-merge";

const measure = (text: string, size: number) => text.length * size * 0.55;
const of = <T extends BoardEl>(els: BoardEl[], t: string) => els.filter((e) => e.t === t) as T[];
const label = (el: ShapeEl) => el.lb?.tx ?? "";

const MATRIX = `quadrantChart
  title Which idea first
  x-axis Less effort --> More effort
  y-axis Less value --> More value
  quadrant-1 Big bets
  quadrant-2 Quick wins
  quadrant-3 Fill-ins
  quadrant-4 Money pits
  Voice notes: [0.2, 0.9]
  Sync:::hot: [0.9, 0.1]`;

describe("board pictures", () => {
  test("a matrix is four tinted sections named after its quadrants, its ideas placed by score", () => {
    const els = mermaidToElements(MATRIX, measure)!;
    const frames = of<FrameEl>(els, "frame");
    expect(frames.map((f) => f.name)).toEqual(["Big bets", "Quick wins", "Fill-ins", "Money pits"]);
    expect(frames.map((f) => f.c)).toEqual([
      "blue-soft",
      "purple-soft",
      "orange-soft",
      "green-soft",
    ]);
    const at = (name: string) => frames.find((f) => f.name === name)!;
    const inside = (el: ShapeEl, f: FrameEl) =>
      el.x >= f.x && el.x + el.w <= f.x + f.w && el.y >= f.y && el.y + el.h <= f.y + f.h;
    const cards = of<ShapeEl>(els, "roundRect");
    expect(cards.map(label)).toEqual(["Voice notes", "Sync"]);
    expect(inside(cards[0], at("Quick wins"))).toBe(true);
    expect(inside(cards[1], at("Money pits"))).toBe(true);
    expect(of(els, "text").map((t) => (t as { tx: string }).tx)).toEqual([
      "Which idea first",
      "Less effort",
      "More effort",
      "More value",
      "Less value",
    ]);
  });

  test("a timeline is a card per period on an arrow, its events under it", () => {
    const els = mermaidToElements(
      "timeline\n  title Launch\n  2026-10 : Beta\n  2026-11 : Talk notes : Boards\n          : Docs\n  2026-12",
      measure,
    )!;
    const cards = of<ShapeEl>(els, "roundRect");
    const periods = cards.filter((c) => ["2026-10", "2026-11", "2026-12"].includes(label(c)));
    expect(periods).toHaveLength(3);
    const under = (period: string) =>
      cards
        .filter((c) => !periods.includes(c) && c.x === periods.find((p) => label(p) === period)!.x)
        .map(label);
    expect(under("2026-11")).toEqual(["Talk notes", "Boards", "Docs"]);
    expect(under("2026-12")).toEqual([]);
    expect(of(els, "arrow")).toHaveLength(1);
  });

  test("any other diagram is one chart card holding its text", () => {
    const src = 'pie title Week\n  "Writing" : 20';
    expect(mermaidToElements(src, measure)).toMatchObject([{ t: "chart", src }]);
    expect(mermaidToElements("not a diagram", measure)).toBeNull();
  });

  test("a chart card is written to the file and read back", () => {
    const scene = emptyScene();
    scene.els = mermaidToElements("xychart-beta\n  x-axis [A, B]\n  bar [1, 2]", measure)!;
    const back = parseBoard(serializeBoard(scene)).scene.els[0] as ChartEl;
    expect(back).toMatchObject({ t: "chart", src: "xychart-beta\n  x-axis [A, B]\n  bar [1, 2]" });
  });

  test("every Picture tray starter draws", () => {
    for (const src of Object.values(PICTURE_STARTERS))
      expect(pictureToElements(src, measure)?.length).toBeGreaterThan(0);
  });

  test("a chart card you only moved keeps its place and takes the AI's new numbers", () => {
    const written = emptyScene();
    written.els = mermaidToElements("xychart-beta\n  x-axis [A]\n  bar [1]", measure)!;
    const file = structuredClone(written);
    file.els[0].x += 200;
    const next = mermaidToElements("xychart-beta\n  x-axis [A]\n  bar [7]", measure)!;
    const { scene, frozen } = mergeTopicBoard(file, written, next, measure);
    expect(frozen).toBe(false);
    expect(scene.els[0]).toMatchObject({
      x: file.els[0].x,
      src: "xychart-beta\n  x-axis [A]\n  bar [7]",
    });
    // Its text edited by hand: it's yours.
    (file.els[0] as ChartEl).src = "xychart-beta\n  x-axis [A]\n  bar [3]";
    expect(mergeTopicBoard(file, written, next, measure).frozen).toBe(true);
  });
});
