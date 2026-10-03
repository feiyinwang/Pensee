import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
  applyAlign,
  applyFontSize,
  applyTextColor,
  summarizeSelection,
} from "../src/components/editor-area/board/board-selection";
import { arcTokenNames, scopeArcFoundation } from "../src/components/editor-area/board/arc-tokens";
import { parseBoard, serializeBoard } from "../src/components/editor-area/board/board-model";

const HEADER = '{"v":1,"vp":{"x":0,"y":0,"zoom":1}}';
const els = (...lines: string[]) => parseBoard([HEADER, ...lines].join("\n")).scene.els;

const SHAPE =
  '{"id":"r1","t":"rect","x":0,"y":0,"w":100,"h":60,"st":{"f":"blue"},"lb":{"tx":"Hi"}}';
const BARE_SHAPE = '{"id":"r2","t":"ellipse","x":0,"y":0,"w":100,"h":60}';
const STICKY = '{"id":"s1","t":"sticky","x":0,"y":0,"w":200,"h":200,"c":"pink","tx":"x"}';
const ARROW = '{"id":"a1","t":"arrow","x":0,"y":0,"w":0,"h":0,"pts":[[0,0],[50,0]]}';

describe("summarizeSelection", () => {
  test("nothing selected shows no toolbar", () => {
    expect(summarizeSelection([])).toBeNull();
  });

  test("a labelled shape offers shape, fill, border and text controls", () => {
    const s = summarizeSelection(els(SHAPE))!;
    expect(s.shapeKind).toBe("rect");
    expect(s.fill).toBe("blue");
    expect(s.stroke).toBe("ink");
    expect(s.textColor).toBe("ink");
    expect(s.fontSize).toBe(14);
    expect(s.route).toBeUndefined();
  });

  test("a shape without text offers no text controls", () => {
    expect(summarizeSelection(els(BARE_SHAPE))!.textColor).toBeUndefined();
  });

  test("a sticky note offers its paper colour and no border", () => {
    const s = summarizeSelection(els(STICKY))!;
    expect(s.sticky).toBe("pink");
    expect(s.stroke).toBeUndefined();
    expect(s.fill).toBeUndefined();
  });

  test("a connector offers line style, route and arrowheads", () => {
    const s = summarizeSelection(els(ARROW))!;
    expect(s.route).toBe("straight");
    expect(s.heads).toEqual({ s: "none", e: "triangle" });
    expect(s.shapeKind).toBeUndefined();
  });
});

describe("text styling on shape labels", () => {
  test("colour, size and alignment persist and ink is the omitted default", () => {
    const scene = parseBoard([HEADER, SHAPE].join("\n")).scene;
    const [shape] = scene.els;
    applyTextColor(shape, "red");
    applyFontSize(shape, 24);
    applyAlign(shape, "l");
    const line = serializeBoard(scene).split("\n")[1];
    expect(JSON.parse(line).lb).toEqual({ tx: "Hi", sz: 24, al: "l", c: "red" });
    applyTextColor(shape, "ink");
    expect(JSON.parse(serializeBoard(scene).split("\n")[1]).lb.c).toBeUndefined();
  });
});

describe("scopeArcFoundation", () => {
  const css = readFileSync(
    new URL("../src/components/arc/foundation.css", import.meta.url),
    "utf8",
  );
  const scoped = scopeArcFoundation(css, ["--accent", "--text-muted"]);

  test("moves every token rule off :root and onto body", () => {
    // Only the host-capture rule may stay on :root.
    const arcRules = scoped.replace(/^:root\{--wr-host[^}]*\}$/m, "");
    expect(arcRules).not.toMatch(/:root(\[[^\]]*\])*\s*\{/);
    expect(scoped).toContain(':root[data-theme="dark"] body');
  });

  test("drops the global no-focus-outline rule", () => {
    expect(css).toContain("*:focus-visible");
    expect(scoped).not.toContain("*:focus-visible");
  });

  test("hands host-owned tokens back to the host value", () => {
    expect(scoped).toContain("--wr-host-accent:var(--accent)");
    expect(scoped).toMatch(/:root:root:root body\{[^}]*--accent:var\(--wr-host-accent\)/);
  });

  test("finds the token names Arc defines", () => {
    expect(arcTokenNames(css)).toEqual(expect.arrayContaining(["--accent", "--surface-raised"]));
  });
});
