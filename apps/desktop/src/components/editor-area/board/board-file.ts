/**
 * `.board.svg` — the portable board file. See `SPECs/board-lark-parity-spec.md`.
 *
 * One file, two readers:
 *  - Any markdown app shows it as an image: the body is the rendered board,
 *    with its colours in its own `<style>` and its pictures inlined, because an
 *    SVG shown through `<img>` can load nothing from outside itself.
 *  - Writer reads the scene back from `<metadata id="writer-board">`, which
 *    holds the same JSON Lines `serializeBoard` writes — one element per line,
 *    so moving a shape is still a one-line diff.
 *
 * Every rendered element also sits on its own line, for the same reason.
 */

import { type BoardScene, type ParseResult, parseBoard, serializeBoard } from "./board-model";
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

/** `null` when the file carries no Writer scene — a plain SVG someone renamed,
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
 * Writer those resolve against the theme; in a file opened anywhere else
 * nothing defines them, so the file brings its own, light and dark.
 */
const FILE_STYLE = `:root{--wr-board-surface:#fff;--wr-board-ink:#1f2328;--wr-board-muted:#6b7280;--wr-board-accent:#0d9488;--wr-board-red:#e5484d;--wr-board-orange:#f76b15;--wr-board-green:#30a46c;--wr-board-blue:#3b82f6;--wr-board-purple:#8e4ec6;--wr-board-frame-bg:rgb(0 0 0/3%);--wr-board-frame-edge:rgb(0 0 0/14%);--wr-board-sticky-yellow:#fdf1c7;--wr-board-sticky-orange:#fadfba;--wr-board-sticky-mint:#d7f2e3;--wr-board-sticky-green:#d6f0cf;--wr-board-sticky-sky:#d3ecf7;--wr-board-sticky-lavender:#dcdcf6;--wr-board-sticky-violet:#ded5f7;--wr-board-sticky-pink:#f6d9ea;--wr-board-sticky-rose:#f8d9d6;--wr-board-sticky-ink:#1e1b16;--wr-board-sticky-edge:rgb(0 0 0/6%)}
@media (prefers-color-scheme:dark){:root{--wr-board-surface:#0d1117;--wr-board-ink:#e6edf3;--wr-board-muted:#9aa4b2;--wr-board-accent:#2dd4bf;--wr-board-red:#ff6369;--wr-board-orange:#ff8b3d;--wr-board-green:#4cc38a;--wr-board-blue:#6a9bff;--wr-board-purple:#b38aea;--wr-board-frame-bg:rgb(255 255 255/4%);--wr-board-frame-edge:rgb(255 255 255/16%);--wr-board-sticky-ink:#1a1a1a}}`;

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
    `<style>${FILE_STYLE}</style>`,
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
