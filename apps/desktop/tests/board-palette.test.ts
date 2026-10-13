import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { HUE_TOKENS, isColor, parseBoard } from "../src/components/editor-area/board/board-model";
import { colorVar } from "../src/components/editor-area/board/board-render";
import { SETTINGS_SCHEMA } from "../src/lib/settings-schema";
import {
  DEFAULT_PALETTE,
  fillOf,
  hexToHsv,
  hsvToHex,
  moveEntry,
  normalizeHex,
  normalizePalette,
  removeEntry,
  replaceEntry,
} from "../src/components/editor-area/board/board-palette";

describe("board palette", () => {
  it("cleans a saved palette", () => {
    expect(normalizePalette(["blue", "blue-soft", "#ABCDEF", "nope", "none", "blue", 3])).toEqual([
      "blue",
      "#abcdef",
    ]);
    expect(normalizePalette("junk")).toEqual([...DEFAULT_PALETTE]);
    expect(normalizePalette([])).toEqual([...DEFAULT_PALETTE]);
  });

  it("pairs a token with its soft fill and keeps a custom colour as picked", () => {
    expect(fillOf("blue")).toBe("blue-soft");
    expect(fillOf("#123456")).toBe("#123456");
  });

  it("moves, replaces and removes entries", () => {
    expect(moveEntry(["a", "b", "c"] as never, 0, 2)).toEqual(["b", "c", "a"]);
    // Replacing with a colour already in the list moves it instead of duplicating it.
    expect(replaceEntry(["red", "blue", "green"], 0, "green")).toEqual(["green", "blue"]);
    expect(removeEntry(["red"], 0)).toEqual([...DEFAULT_PALETTE]);
  });

  it("round-trips HSV and hex", () => {
    for (const hex of ["#3b82f6", "#e5484d", "#000000", "#ffffff", "#7f7f00"]) {
      expect(hsvToHex(hexToHsv(hex)!)).toBe(hex);
    }
    expect(normalizeHex(" ABC ")).toBe("#aabbcc");
    expect(normalizeHex("#12345")).toBeNull();
  });

  it("accepts only known colour shapes from a file", () => {
    expect(isColor("blue-soft")).toBe(true);
    expect(isColor("#a1b2c3")).toBe(true);
    expect(isColor("red);x:url(y")).toBe(false);
    expect(isColor("#a1b2c3;")).toBe(false);
    const { scene } = parseBoard(
      ['{"v":1}', '{"id":"r","t":"rect","st":{"f":"url(evil)","s":"#00ff00"}}'].join("\n"),
    );
    const st = (scene.els[0] as { st: { f: string; s: string } }).st;
    expect(st).toMatchObject({ f: "none", s: "#00ff00" });
  });

  it("draws a custom colour through the dark-mode remap", () => {
    expect(colorVar("blue")).toBe("var(--wr-board-blue)");
    expect(colorVar("#00ff00")).toMatch(/^oklch\(from #00ff00 /);
  });

  it("offers every colour but `accent`, which is the same colour as `ink`", () => {
    expect(DEFAULT_PALETTE).not.toContain("accent");
    expect(DEFAULT_PALETTE).toEqual(HUE_TOKENS.filter((t) => t !== "accent"));
    const schemaDefault = SETTINGS_SCHEMA.find((def) => def.key === "board.palette")?.default;
    expect(schemaDefault).toEqual([...DEFAULT_PALETTE]);
    // A saved palette that still lists it keeps it.
    expect(normalizePalette(["ink", "accent"])).toEqual(["ink", "accent"]);
  });

  it("draws every hue token in a dot colour or a neutral, never a raw colour", () => {
    const css = readFileSync(resolve(__dirname, "../src/styles/tokens.css"), "utf8");
    for (const h of HUE_TOKENS) {
      const decl = new RegExp(`--wr-board-${h}:\\s*([^;]+);`).exec(css)?.[1];
      expect(decl, h).toMatch(/^var\(--color-(dot-[a-z]+|text-primary|text-muted)\)$/);
    }
  });

  it("declares a soft tint in board.css for every hue token", () => {
    const css = readFileSync(resolve(__dirname, "../src/styles/tokens.css"), "utf8");
    for (const h of HUE_TOKENS) expect(css).toContain(`--wr-board-${h}-soft:`);
  });
});
