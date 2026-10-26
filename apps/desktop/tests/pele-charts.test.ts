import { describe, expect, test } from "vite-plus/test";
import { parse } from "pele";
import { chartFor } from "../src/components/editor-area/pele-charts";

// Real Pele models: the adapters read Pele's parsed shapes, so a Pele update
// that moves a field shows up here.
describe("chartFor", () => {
  test("pie → donut with one slice per section", () => {
    const spec = chartFor(parse('pie title Fish\n  "Ahi" : 386\n  "Ono" : 15'));
    expect(spec).toEqual({
      chart: "donut",
      props: {
        label: "Fish",
        data: [
          { key: "Ahi", label: "Ahi", value: 386 },
          { key: "Ono", label: "Ono", value: 15 },
        ],
      },
    });
  });

  test("an xychart with one bar series → bar chart; with a line → line chart", () => {
    const bar = chartFor(parse("xychart\n  x-axis [a, b]\n  bar [3, 5]"));
    expect(bar?.chart).toBe("bar");
    if (bar?.chart === "bar") expect(bar.props.data.map((d) => d.value)).toEqual([3, 5]);
    const line = chartFor(parse("xychart\n  x-axis [a, b]\n  bar [3, 5]\n  line [2, 4]"));
    expect(line?.chart).toBe("line");
  });

  test("sankey → Sankey flow with string node ids", () => {
    const spec = chartFor(parse("sankey\nGrid,Homes,113\nGrid,Industry,342"));
    expect(spec?.chart).toBe("sankey");
    if (spec?.chart === "sankey")
      expect(spec.props.links[0]).toEqual({ source: "Grid", target: "Homes", value: 113 });
  });

  test("radar with more than three series is left to Pele", () => {
    const four = ["a", "b", "c", "d"].map((c) => `  curve ${c}{1, 2, 3}`).join("\n");
    expect(chartFor(parse(`radar-beta\n  axis x, y, z\n${four}`))).toBeNull();
    expect(chartFor(parse("radar-beta\n  axis x, y, z\n  curve a{1, 2, 3}"))?.chart).toBe("radar");
  });

  test("kanban → columns and cards", () => {
    const spec = chartFor(
      parse("kanban\n  todo[Todo]\n    t1[Write the spec]\n  done[Done]\n    d1[Pick Ask]"),
    );
    expect(spec?.chart).toBe("kanban");
    if (spec?.chart === "kanban") {
      expect(spec.props.columns.map((c) => c.name)).toEqual(["Todo", "Done"]);
      expect(spec.props.cards.map((c) => [c.title, c.column])).toEqual([
        ["Write the spec", "todo"],
        ["Pick Ask", "done"],
      ]);
    }
  });

  test("diagrams no Arc chart draws return null", () => {
    expect(chartFor(parse("flowchart LR\n  A --> B"))).toBeNull();
    expect(chartFor(parse("mindmap\n  root((Talk))\n    One"))).toBeNull();
  });
});
