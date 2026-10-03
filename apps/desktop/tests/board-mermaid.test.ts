import { describe, expect, test } from "vite-plus/test";
import {
  flowchartToElements,
  parseMermaidFlowchart,
} from "../src/components/editor-area/board/board-mermaid";
import {
  type LinkerEl,
  type ShapeEl,
  isLinker,
} from "../src/components/editor-area/board/board-model";

const SRC = `flowchart TD
  %% a comment
  A[Start] --> B{Is it ok?}
  B -->|Yes| C(Ship)
  B -- No --> D((Fix))
  D -.-> B
  C & D --> E[[Done]]
  classDef x fill:#f00
  style A fill:#eee`;

describe("parseMermaidFlowchart", () => {
  const g = parseMermaidFlowchart(SRC)!;

  test("reads nodes with their shapes and text", () => {
    expect(g.dir).toBe("TD");
    expect(g.nodes.get("B")).toMatchObject({ text: "Is it ok?", shape: "diamond" });
    expect(g.nodes.get("C")?.shape).toBe("roundRect");
    expect(g.nodes.get("D")?.shape).toBe("ellipse");
    expect(g.nodes.get("E")).toMatchObject({ text: "Done", shape: "rect" });
  });

  test("reads labelled, dashed and grouped links", () => {
    const pairs = g.edges.map(
      (e) => `${e.from}>${e.to}${e.label ? ":" + e.label : ""}${e.dashed ? "~" : ""}`,
    );
    expect(pairs).toEqual(["A>B", "B>C:Yes", "B>D:No", "D>B~", "C>E", "D>E"]);
  });

  test("chains and bare ids", () => {
    const chain = parseMermaidFlowchart("graph LR\n a --> b --- c")!;
    expect(chain.dir).toBe("LR");
    expect(chain.edges.map((e) => [e.from, e.to, e.arrow])).toEqual([
      ["a", "b", true],
      ["b", "c", false],
    ]);
    expect(chain.nodes.get("a")?.text).toBe("a");
  });

  test("rejects other diagram types", () => {
    expect(parseMermaidFlowchart("sequenceDiagram\n A->>B: hi")).toBeNull();
  });
});

describe("flowchartToElements", () => {
  const els = flowchartToElements(parseMermaidFlowchart(SRC)!);
  const shapes = els.filter((e) => !isLinker(e)) as ShapeEl[];
  const links = els.filter(isLinker) as LinkerEl[];
  const byText = (t: string) => shapes.find((s) => s.lb?.tx === t)!;

  test("one shape per node and one connector per edge, bound at both ends", () => {
    expect(shapes).toHaveLength(5);
    expect(links).toHaveLength(6);
    const ids = new Set(shapes.map((s) => s.id));
    for (const l of links) {
      expect(ids.has(l.b1!.el) && ids.has(l.b2!.el)).toBe(true);
    }
    expect(links.find((l) => l.lb?.tx === "Yes")).toBeTruthy();
  });

  test("top-down flow puts each rank below the previous, cycle ignored", () => {
    expect(byText("Is it ok?").y).toBeGreaterThan(byText("Start").y);
    expect(byText("Ship").y).toBeGreaterThan(byText("Is it ok?").y);
    expect(byText("Done").y).toBeGreaterThan(byText("Ship").y);
  });

  test("no two shapes overlap", () => {
    for (const a of shapes)
      for (const b of shapes) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
  });
});
