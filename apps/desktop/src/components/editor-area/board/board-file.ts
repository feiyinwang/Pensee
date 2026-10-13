/**
 * `.board.svg` — the portable board file. See `SPECs/board-lark-parity-spec.md`.
 *
 * One file, two readers:
 *  - Any markdown app shows it as an image: the body is the rendered board,
 *    with its colours in its own `<style>` and its pictures inlined, because an
 *    SVG shown through `<img>` can load nothing from outside itself.
 *  - Pensée reads the scene back from `<metadata id="writer-board">`, which
 *    holds the same JSON Lines `serializeBoard` writes — one element per line,
 *    so moving a shape is still a one-line diff.
 *
 * Every rendered element also sits on its own line, for the same reason.
 */

import {
  type BoardScene,
  HUE_TOKENS,
  type ParseResult,
  parseBoard,
  serializeBoard,
} from "./board-model";
import { boxesUnion, elementBounds } from "./board-geometry";
import { renderElement } from "./board-render";

export const BOARD_FILE_SUFFIX = ".board.svg";
const META_ID = "writer-board";
const PAD = 32;
const EMPTY = { w: 480, h: 270 };

export function isBoardFile(src: string): boolean {
  return src.split(/[?#]/)[0].toLowerCase().endsWith(BOARD_FILE_SUFFIX);
}

/* -------------------------------------------------------------- read */

const META_RE = new RegExp(`<metadata id="${META_ID}"[^>]*>([\\s\\S]*?)</metadata>`);

function unescapeXml(text: string): string {
  return text.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, code: string) => {
    switch (code.toLowerCase()) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      case "amp":
        return "&";
    }
    const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1));
    return String.fromCodePoint(n);
  });
}

/** `null` when the file carries no Pensée scene — a plain SVG someone renamed,
 *  or a board an outside editor flattened. The caller says so; it never opens
 *  an empty board over the top of someone's drawing. */
export function readBoardSvg(text: string): ParseResult | null {
  const match = META_RE.exec(text);
  if (!match) return null;
  let body = match[1];
  const cdata = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(body);
  body = cdata ? cdata[1] : unescapeXml(body);
  return parseBoard(body.trim());
}

/* ------------------------------------------------------------- write */

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Concrete colours for the `--wr-board-*` tokens the renderer emits. Inside
 * Pensée those resolve against the theme; in a file opened anywhere else
 * nothing defines them, so the file brings its own, light and dark.
 */
const SOFT_TOKENS = HUE_TOKENS.map(
  (h) =>
    `--wr-board-${h}-soft:color-mix(in oklab,var(--wr-board-${h}) 22%,var(--wr-board-surface))`,
).join(";");

/** One mode's colours for a file opened outside Pensée: the warm neutrals
 *  and the dot colours of App.css (SPECs/harvey-neutral-colour-spec.md).
 *  `paper` and `wash` make the sticky notes, as in board.css. */
interface FileInks {
  surface: string;
  ink: string;
  muted: string;
  red: string;
  orange: string;
  yellow: string;
  green: string;
  blue: string;
  purple: string;
  pink: string;
  paper: string;
  wash: string;
  flip: 0 | 1;
}

/** The dots are one set for both modes (App.css `--dot-*`). */
const DOTS = {
  red: "#cc4b3c",
  orange: "#c46a22",
  yellow: "#a8820a",
  green: "#3f8f5a",
  blue: "#3c72c9",
  purple: "#8a5cc7",
  pink: "#c4508a",
} as const;

export const FILE_LIGHT: FileInks = {
  surface: "#fafaf9",
  ink: "#0f0e0d",
  muted: "#706d66",
  ...DOTS,
  paper: "#f2f1f0",
  wash: "10%",
  flip: 0,
};

const FILE_DARK: FileInks = {
  surface: "#0f0e0d",
  ink: "#fafaf9",
  muted: "#8f8b85",
  ...DOTS,
  paper: "#1c1b19",
  wash: "16%",
  flip: 1,
};

/** Sticky colour → the hue that tints it and whether it is a pale (60%) tint.
 *  Mirrors the `--wr-board-sticky-*` block in board.css. */
const STICKY_WASH: [sticky: string, hue: string, pale: boolean][] = [
  ["yellow", "yellow", false],
  ["orange", "orange", false],
  ["mint", "green", true],
  ["green", "green", false],
  ["sky", "blue", true],
  ["lavender", "purple", true],
  ["violet", "purple", false],
  ["pink", "pink", false],
  ["rose", "red", false],
];

function fileTokens(c: FileInks): string {
  const hues = [
    "ink",
    "muted",
    "red",
    "orange",
    "yellow",
    "green",
    "blue",
    "purple",
    "pink",
  ] as const;
  const stickies = STICKY_WASH.map(
    ([sticky, hue, pale]) =>
      `--wr-board-sticky-${sticky}:color-mix(in oklab,var(--wr-board-${hue}) ${pale ? "calc(var(--wr-board-sticky-wash) * 0.6)" : "var(--wr-board-sticky-wash)"},var(--wr-board-sticky-paper))`,
  );
  return [
    ...hues.map((h) => `--wr-board-${h}:${c[h]}`),
    `--wr-board-accent:${c.ink}`,
    `--wr-board-surface:${c.surface}`,
    `--wr-board-flip:${c.flip}`,
    `--wr-board-frame-bg:color-mix(in srgb,${c.ink} 3%,transparent)`,
    `--wr-board-frame-edge:color-mix(in srgb,${c.ink} 14%,transparent)`,
    `--wr-board-sticky-paper:${c.paper}`,
    `--wr-board-sticky-wash:${c.wash}`,
    ...stickies,
    `--wr-board-sticky-ink:${c.ink}`,
    `--wr-board-sticky-edge:color-mix(in srgb,${c.ink} 8%,transparent)`,
  ].join(";");
}

const FILE_STYLE = `.wr-board-expand{display:none}:root{${SOFT_TOKENS};${fileTokens(FILE_LIGHT)}}
@media (prefers-color-scheme:dark){:root{${fileTokens(FILE_DARK)}}}`;

const STYLE_RE = /<style>[\s\S]*?<\/style>/;
const CURRENT_STYLE = `<style>${FILE_STYLE}</style>`;

/**
 * A board file's text with its colours brought up to date, or `null` when
 * they already are (or it has no `<style>`). A `.board.svg` carries its
 * colours in its own `<style>`, so one saved before a palette change keeps
 * the old colours in the note's `<img>` preview until it is saved again; the
 * preview shows this instead, and the file on disk is left as it is. Only the
 * first `<style>` is the file's own; the rest is the drawing. A function
 * replacer, so nothing in the style is ever read as a `$` pattern.
 */
export function withCurrentStyle(text: string): string | null {
  const match = STYLE_RE.exec(text);
  if (!match || match[0] === CURRENT_STYLE) return null;
  return text.replace(STYLE_RE, () => CURRENT_STYLE);
}

const SVG_NS_ATTR = / xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g;

/**
 * The whole file as text. `resolveSrc` must hand back something an isolated
 * SVG can show — a `data:` URL — for every picture; see the header note.
 */
export function renderBoardSvg(scene: BoardScene, resolveSrc: (src: string) => string): string {
  const union = boxesUnion(scene.els.map((el) => elementBounds(el)));
  const box =
    union && union.w > 0 && union.h > 0
      ? { x: union.x - PAD, y: union.y - PAD, w: union.w + PAD * 2, h: union.h + PAD * 2 }
      : { x: 0, y: 0, ...EMPTY };
  const r = (n: number) => Math.round(n);

  const serializer = new XMLSerializer();
  const ctx = { resolveSrc, scene };
  const body = scene.els.map((el) =>
    serializer.serializeToString(renderElement(el, ctx)).replace(SVG_NS_ATTR, ""),
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(box.x)} ${r(box.y)} ${r(box.w)} ${r(box.h)}" width="${r(box.w)}" height="${r(box.h)}" data-writer-board="1">`,
    `<metadata id="${META_ID}">`,
    escapeXml(serializeBoard(scene)),
    `</metadata>`,
    CURRENT_STYLE,
    ...body,
    `</svg>`,
    "",
  ].join("\n");
}

/* ------------------------------------------------------------- paths */

/** Relative path from `fromDir` to `absolute`, `/`-separated. */
export function relativePath(fromDir: string, absolute: string): string {
  const from = fromDir.replace(/\\/g, "/").replace(/\/$/, "").split("/");
  const to = absolute.replace(/\\/g, "/").split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill(".."), ...to.slice(i)].join("/");
}
