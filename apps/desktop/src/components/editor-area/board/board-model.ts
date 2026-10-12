/**
 * Board scene model — pure data. No DOM, no CodeMirror.
 *
 * Storage format is **JSON Lines** inside a ```board fence:
 *
 *   line 0   header  {"v":1,"vp":{...},"bg":"dot"}
 *   line 1+  one element per line
 *
 * Why JSONL and not one big JSON object:
 *  - Moving one shape produces a one-line git diff. A single pretty-printed
 *    JSON reorders/reindents wide swathes; a single minified JSON is always
 *    "one line changed, entirely".
 *  - A corrupt line loses one element, not the whole board.
 *  - Serializing is `map(JSON.stringify).join("\n")` — no pretty-printer.
 *
 * DOC SIZE IS A HARD CONSTRAINT (see `SIZE_BUDGET`). Every choice here exists
 * to keep the markdown file small:
 *  - keys are 1–2 chars
 *  - default values are omitted on write and re-filled on read
 *  - coordinates are rounded to 1 decimal
 *  - images are NEVER inlined; only a relative path to the note's assets folder
 */

export const BOARD_FENCE_INFO = "board";

/** Warn above this many bytes of fence text. Not enforced — just surfaced. */
export const SIZE_BUDGET = {
  warnBytes: 64 * 1024,
  warnElements: 800,
} as const;

/* ------------------------------------------------------------------ types */

/** The `--wr-board-<name>` colour tokens, neutrals first, then round the
 *  hue wheel (FigJam's order). See SPECs/board-color-palette-spec.md. */
export const HUE_TOKENS = [
  "ink",
  "muted",
  "red",
  "orange",
  "yellow",
  "green",
  "accent",
  "blue",
  "purple",
  "pink",
] as const;
export type HueToken = (typeof HUE_TOKENS)[number];

/** A stored colour: a token (strong), its `-soft` tint (for fills), a custom
 *  `#rrggbb`, or `none`. */
export type ColorToken = HueToken | `${HueToken}-soft` | `#${string}` | "none";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Board files are untrusted input: only these shapes of string are colours. */
export function isColor(v: unknown): v is ColorToken {
  if (typeof v !== "string") return false;
  if (v === "none" || HEX_COLOR.test(v)) return true;
  const base = v.endsWith("-soft") ? v.slice(0, -5) : v;
  return (HUE_TOKENS as readonly string[]).includes(base);
}

function color(v: unknown, fallback: ColorToken): ColorToken {
  return isColor(v) ? v : fallback;
}

export type StickyColor =
  | "yellow"
  | "orange"
  | "mint"
  | "green"
  | "sky"
  | "lavender"
  | "violet"
  | "pink"
  | "rose";

export type ShapeKind =
  | "rect"
  | "roundRect"
  | "ellipse"
  | "diamond"
  | "triangle"
  | "pentagon"
  | "hexagon"
  | "star"
  | "bubble"
  | "cross";

export type LinkerKind = "line" | "arrow";
export type LinkerShape = "straight" | "elbow" | "curved";
export type ArrowHead = "none" | "triangle" | "line" | "dot";
export type StrokeDash = "solid" | "dashed" | "dotted";
export type FramePreset = "custom" | "16:9" | "4:3" | "1:1" | "A4";

export type ElementType =
  | ShapeKind
  | "text"
  | "sticky"
  | LinkerKind
  | "frame"
  | "image"
  | "mind"
  | "draw";

export interface Style {
  /** stroke */ s: ColorToken;
  /** fill */ f: ColorToken;
  /** stroke width */ w: number;
  /** dash */ d: StrokeDash;
  /** corner radius */ r: number;
}

export interface Label {
  tx: string;
  /** font size */ sz: number;
  /** horizontal align */ al: "l" | "c" | "r";
  /** text colour; omitted means ink */ c?: ColorToken;
}

export interface Binding {
  /** bound element id */ el: string;
  /** focus: -1..1, position along the target's boundary (Excalidraw model) */ fx: number;
  /** gap from the boundary, px */ gap: number;
  /** pinned side for elbow routing; omitted means the side facing the other end */ sd?: BoxSide;
}

export type BoxSide = "n" | "e" | "s" | "w";

interface Base {
  id: string;
  t: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** rotation, radians */ a: number;
  /** opacity 0..1 */ op: number;
  /** group id */ g?: string;
  /** owning frame id */ fr?: string;
  lk?: true;
}

export interface ShapeEl extends Base {
  t: ShapeKind;
  st: Style;
  lb?: Label;
  /** Height before the label's caret grew the shape to fit its text; present
   *  only while expanded, and what the caret shrinks it back to. */
  ex?: number;
  /** The whole label links here: a wiki target, `Page#^bk-…` for a book
   *  highlight (board-book-links.ts). Kept apart from the text, so editing
   *  the text never breaks the link. */
  ln?: string;
}

export interface TextEl extends Base {
  t: "text";
  tx: string;
  sz: number;
  al: "l" | "c" | "r";
  c: ColorToken;
}

export interface StickyEl extends Base {
  t: "sticky";
  c: StickyColor;
  tx: string;
}

export interface LinkerEl extends Base {
  t: LinkerKind;
  sh: LinkerShape;
  /** path points relative to (x,y) */ pts: [number, number][];
  b1?: Binding;
  b2?: Binding;
  hd: { s: ArrowHead; e: ArrowHead };
  st: Style;
  /** text on the line, drawn at its midpoint (flowchart "yes" / "no") */
  lb?: { tx: string; sz: number };
}

export interface FrameEl extends Base {
  t: "frame";
  name: string;
  preset: FramePreset;
}

export interface ImageEl extends Base {
  t: "image";
  /** path relative to the markdown file — never a data: URL, see header note */
  src: string;
  /** natural aspect, used to restore size after a bad resize */ ar?: number;
  alt?: string;
}

/**
 * One mind-map topic. The tree is the `pa` (parent) links; the root has none.
 * Positions and sizes are laid out by `board-mind.ts` and stored like any
 * element's, so the file renders without Writer.
 */
export interface MindEl extends Base {
  t: "mind";
  tx: string;
  /** parent topic id; absent on the root */ pa?: string;
  /** branch colour, set on first-level topics and inherited below */ c?: ColorToken;
  /** side of the root a first-level topic grows on */ sd?: "l" | "r";
  /** A video pin, `Page#^yt-<seconds>` (board-video-links.ts). */
  ln?: string;
}

/**
 * A pen stroke. `pts` are relative to (x, y) as drawn; a resize changes w/h and
 * the renderer scales the path to fit, so the points never need rewriting.
 */
export interface DrawEl extends Base {
  t: "draw";
  pts: [number, number][];
  st: Style;
}

export type BoardEl = ShapeEl | TextEl | StickyEl | LinkerEl | FrameEl | ImageEl | MindEl | DrawEl;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface BoardHeader {
  v: 1;
  vp: Viewport;
  bg: "none" | "dot" | "grid";
}

export interface BoardScene {
  header: BoardHeader;
  /** array order IS z-order */
  els: BoardEl[];
}

export interface ParseResult {
  scene: BoardScene;
  /** lines that failed to parse — surfaced as a banner, never silently dropped */
  badLines: number;
}

/* --------------------------------------------------------------- defaults */

export const SHAPE_KINDS: ShapeKind[] = [
  "roundRect",
  "rect",
  "ellipse",
  "diamond",
  "triangle",
  "pentagon",
  "hexagon",
  "star",
  "bubble",
  "cross",
];

export const STICKY_COLORS: StickyColor[] = [
  "yellow",
  "orange",
  "mint",
  "green",
  "sky",
  "lavender",
  "violet",
  "pink",
  "rose",
];

export const STICKY_SIZE = 200;

export const FRAME_PRESETS: Record<FramePreset, { w: number; h: number } | null> = {
  custom: null,
  "16:9": { w: 1600, h: 900 },
  "4:3": { w: 1200, h: 900 },
  "1:1": { w: 1000, h: 1000 },
  A4: { w: 794, h: 1123 },
};

/** The file-format default: values equal to it are left out of the file, so
 *  changing it would recolour every existing board. New shapes use
 *  `newShapeStyle` instead. */
const DEFAULT_STYLE: Style = { s: "ink", f: "none", w: 1.5, d: "solid", r: 8 };

export function defaultStyle(over: Partial<Style> = {}): Style {
  return { ...DEFAULT_STYLE, ...over };
}

/** FigJam's default: a soft fill with the strong outline of the same hue. */
export function newShapeStyle(): Style {
  return defaultStyle({ f: "blue-soft", s: "blue" });
}

const DEFAULT_HEADER: BoardHeader = { v: 1, vp: { x: 0, y: 0, zoom: 1 }, bg: "dot" };

export function emptyScene(): BoardScene {
  return { header: { ...DEFAULT_HEADER, vp: { ...DEFAULT_HEADER.vp } }, els: [] };
}

/* --------------------------------------------------------------------- id */

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 8-char id. Board-unique, never reused — deleting an element does not free
 *  its id, because bindings elsewhere may still name it during an undo. */
export function newId(): string {
  let out = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

/* ------------------------------------------------------------------ parse */

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function parseStyle(raw: unknown): Style {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    s: color(o.s, DEFAULT_STYLE.s),
    f: color(o.f, DEFAULT_STYLE.f),
    w: num(o.w, DEFAULT_STYLE.w),
    d: str(o.d, DEFAULT_STYLE.d) as StrokeDash,
    r: num(o.r, DEFAULT_STYLE.r),
  };
}

function parseLabel(raw: unknown): Label | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const tx = str(o.tx, "");
  if (!tx) return undefined;
  const label: Label = { tx, sz: num(o.sz, 14), al: str(o.al, "c") as Label["al"] };
  if (isColor(o.c) && o.c !== "ink") label.c = o.c;
  return label;
}

function parseBinding(raw: unknown): Binding | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const el = str(o.el, "");
  if (!el) return undefined;
  const b: Binding = { el, fx: num(o.fx, 0), gap: num(o.gap, 6) };
  if (o.sd === "n" || o.sd === "e" || o.sd === "s" || o.sd === "w") b.sd = o.sd;
  return b;
}

function serializeBinding(b: Binding): Record<string, unknown> {
  const o: Record<string, unknown> = { el: b.el, fx: Math.round(b.fx * 1000) / 1000, gap: b.gap };
  if (b.sd) o.sd = b.sd;
  return o;
}

function parseElement(raw: unknown): BoardEl | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const t = str(o.t, "") as ElementType;
  if (!t) return null;

  const base: Base = {
    id: str(o.id, "") || newId(),
    t,
    x: num(o.x, 0),
    y: num(o.y, 0),
    w: num(o.w, 100),
    h: num(o.h, 100),
    a: num(o.a, 0),
    op: num(o.op, 1),
  };
  if (typeof o.g === "string") base.g = o.g;
  if (typeof o.fr === "string") base.fr = o.fr;
  if (o.lk === true) base.lk = true;

  if (t === "text") {
    return {
      ...base,
      t,
      tx: str(o.tx, ""),
      sz: num(o.sz, 16),
      al: str(o.al, "l") as TextEl["al"],
      c: color(o.c, "ink"),
    };
  }
  if (t === "sticky") {
    return {
      ...base,
      t,
      w: STICKY_SIZE,
      h: STICKY_SIZE,
      c: str(o.c, "yellow") as StickyColor,
      tx: str(o.tx, ""),
    };
  }
  if (t === "line" || t === "arrow") {
    const rawPts = Array.isArray(o.pts) ? o.pts : [];
    const pts: [number, number][] = rawPts
      .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
      .map((p) => [num(p[0], 0), num(p[1], 0)] as [number, number]);
    if (pts.length < 2) pts.push([0, 0], [100, 0]);
    const hd = (o.hd ?? {}) as Record<string, unknown>;
    const rawLb = (o.lb ?? null) as Record<string, unknown> | null;
    const lbText = rawLb ? str(rawLb.tx, "") : "";
    return {
      ...base,
      t,
      ...(lbText ? { lb: { tx: lbText, sz: num(rawLb?.sz, 13) } } : {}),
      sh: str(o.sh, "straight") as LinkerShape,
      pts,
      b1: parseBinding(o.b1),
      b2: parseBinding(o.b2),
      hd: {
        s: str(hd.s, "none") as ArrowHead,
        e: str(hd.e, t === "arrow" ? "triangle" : "none") as ArrowHead,
      },
      st: parseStyle(o.st),
    };
  }
  if (t === "frame") {
    return {
      ...base,
      t,
      name: str(o.name, "Section"),
      preset: str(o.preset, "custom") as FramePreset,
    };
  }
  if (t === "image") {
    const el: ImageEl = { ...base, t, src: str(o.src, "") };
    if (typeof o.ar === "number") el.ar = o.ar;
    if (typeof o.alt === "string") el.alt = o.alt;
    return el.src ? el : null;
  }
  if ((SHAPE_KINDS as string[]).includes(t)) {
    const shape: ShapeEl = {
      ...base,
      t: t as ShapeKind,
      st: parseStyle(o.st),
      lb: parseLabel(o.lb),
    };
    if (typeof o.ex === "number" && Number.isFinite(o.ex) && o.ex > 0) shape.ex = o.ex;
    if (typeof o.ln === "string" && o.ln) shape.ln = o.ln;
    return shape;
  }
  if (t === "draw") {
    const raw = Array.isArray(o.pts) ? o.pts : [];
    const pts = raw
      .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
      .map((p) => [num(p[0], 0), num(p[1], 0)] as [number, number]);
    return pts.length >= 2 ? { ...base, t, pts, st: parseStyle(o.st) } : null;
  }
  if (t === "mind") {
    const el: MindEl = { ...base, t, tx: str(o.tx, "") };
    if (typeof o.pa === "string") el.pa = o.pa;
    if (isColor(o.c)) el.c = o.c;
    if (o.sd === "l" || o.sd === "r") el.sd = o.sd;
    if (typeof o.ln === "string" && o.ln) el.ln = o.ln;
    return el;
  }
  return null;
}

export function parseBoard(source: string): ParseResult {
  const scene = emptyScene();
  let badLines = 0;
  const lines = source.split("\n");
  let sawHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      badLines += 1;
      continue;
    }
    if (!obj || typeof obj !== "object") {
      badLines += 1;
      continue;
    }
    const o = obj as Record<string, unknown>;
    if (!sawHeader && o.v !== undefined) {
      const vp = (o.vp ?? {}) as Record<string, unknown>;
      scene.header = {
        v: 1,
        vp: { x: num(vp.x, 0), y: num(vp.y, 0), zoom: clampZoom(num(vp.zoom, 1)) },
        bg: str(o.bg, "dot") as BoardHeader["bg"],
      };
      sawHeader = true;
      continue;
    }
    const el = parseElement(o);
    if (el) scene.els.push(el);
    else badLines += 1;
  }

  return { scene, badLines };
}

/* -------------------------------------------------------------- serialize */

const R = (n: number) => Math.round(n * 10) / 10;

function pruneStyle(st: Style): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (st.s !== DEFAULT_STYLE.s) out.s = st.s;
  if (st.f !== DEFAULT_STYLE.f) out.f = st.f;
  if (st.w !== DEFAULT_STYLE.w) out.w = R(st.w);
  if (st.d !== DEFAULT_STYLE.d) out.d = st.d;
  if (st.r !== DEFAULT_STYLE.r) out.r = R(st.r);
  return Object.keys(out).length ? out : undefined;
}

/** Drops every field that equals its parse-time default. Round-trips exactly;
 *  cuts a typical board's byte count roughly in half. */
function pruneElement(el: BoardEl): Record<string, unknown> {
  const o: Record<string, unknown> = { id: el.id, t: el.t, x: R(el.x), y: R(el.y) };
  if (el.t !== "sticky") {
    o.w = R(el.w);
    o.h = R(el.h);
  }
  if (el.a) o.a = Math.round(el.a * 1000) / 1000;
  if (el.op !== 1) o.op = R(el.op);
  if (el.g) o.g = el.g;
  if (el.fr) o.fr = el.fr;
  if (el.lk) o.lk = true;

  switch (el.t) {
    case "draw": {
      o.pts = el.pts.map(([px, py]) => [R(px), R(py)]);
      const st = pruneStyle(el.st);
      if (st) o.st = st;
      break;
    }
    case "mind": {
      o.tx = el.tx;
      if (el.pa) o.pa = el.pa;
      if (el.c) o.c = el.c;
      if (el.sd) o.sd = el.sd;
      if (el.ln) o.ln = el.ln;
      break;
    }
    case "text": {
      o.tx = el.tx;
      if (el.sz !== 16) o.sz = el.sz;
      if (el.al !== "l") o.al = el.al;
      if (el.c !== "ink") o.c = el.c;
      break;
    }
    case "sticky": {
      o.c = el.c;
      if (el.tx) o.tx = el.tx;
      break;
    }
    case "line":
    case "arrow": {
      if (el.sh !== "straight") o.sh = el.sh;
      o.pts = el.pts.map(([px, py]) => [R(px), R(py)]);
      if (el.b1) o.b1 = serializeBinding(el.b1);
      if (el.b2) o.b2 = serializeBinding(el.b2);
      const defEnd = el.t === "arrow" ? "triangle" : "none";
      if (el.hd.s !== "none" || el.hd.e !== defEnd) o.hd = el.hd;
      const st = pruneStyle(el.st);
      if (st) o.st = st;
      if (el.lb?.tx) o.lb = el.lb.sz === 13 ? { tx: el.lb.tx } : { tx: el.lb.tx, sz: el.lb.sz };
      break;
    }
    case "frame": {
      o.name = el.name;
      if (el.preset !== "custom") o.preset = el.preset;
      break;
    }
    case "image": {
      o.src = el.src;
      if (el.ar) o.ar = Math.round(el.ar * 1000) / 1000;
      if (el.alt) o.alt = el.alt;
      break;
    }
    default: {
      const st = pruneStyle(el.st);
      if (st) o.st = st;
      if (el.lb?.tx) {
        const lb: Record<string, unknown> = { tx: el.lb.tx };
        if (el.lb.sz !== 14) lb.sz = el.lb.sz;
        if (el.lb.al !== "c") lb.al = el.lb.al;
        if (el.lb.c && el.lb.c !== "ink") lb.c = el.lb.c;
        o.lb = lb;
      }
      if (el.ex) o.ex = R(el.ex);
      if (el.ln) o.ln = el.ln;
    }
  }
  return o;
}

export function serializeBoard(scene: BoardScene): string {
  const header: Record<string, unknown> = {
    v: 1,
    vp: { x: R(scene.header.vp.x), y: R(scene.header.vp.y), zoom: R(scene.header.vp.zoom) },
  };
  if (scene.header.bg !== "dot") header.bg = scene.header.bg;
  const lines = [
    JSON.stringify(header),
    ...scene.els.map((el) => JSON.stringify(pruneElement(el))),
  ];
  return lines.join("\n");
}

export function fenceFor(scene: BoardScene): string {
  return "```" + BOARD_FENCE_INFO + "\n" + serializeBoard(scene) + "\n```";
}

export function emptyFence(): string {
  return fenceFor(emptyScene());
}

/* ------------------------------------------------------------- size guard */

export function sceneSize(scene: BoardScene): { bytes: number; overBudget: boolean } {
  const bytes = new TextEncoder().encode(serializeBoard(scene)).length;
  return {
    bytes,
    overBudget: bytes > SIZE_BUDGET.warnBytes || scene.els.length > SIZE_BUDGET.warnElements,
  };
}

/* ---------------------------------------------------------------- helpers */

/** Zoom limits: 10% to 500%. */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 5;

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** How far past a limit a pinch can stretch the board (15%, as a log). */
const ZOOM_STRETCH = Math.log(1.15);

/** A pinch past a zoom limit keeps moving the board, ever more stiffly, and
 *  never more than 15% past it; it springs back on release. Inside the
 *  limits it is the identity, and it leaves the edge at the same speed it
 *  arrived (tanh has slope 1 at 0), so there is no kink at the limit. */
export function stretchZoom(z: number): number {
  const edge = clampZoom(z);
  if (edge === z) return z;
  const over = Math.log(z / edge);
  return edge * Math.exp(ZOOM_STRETCH * Math.tanh(over / ZOOM_STRETCH));
}

/** The furthest a pinch's own (unstretched) zoom runs past a limit. Beyond
 *  this the stretch is flat, so reversing would only unwind dead travel. */
export function boundGestureZoom(z: number): number {
  const reach = Math.exp(3 * ZOOM_STRETCH);
  return Math.min(ZOOM_MAX * reach, Math.max(ZOOM_MIN / reach, z));
}

/** Keeps runaway drags from pushing the scene bounds to infinity, which would
 *  make Zoom-to-fit render everything at 0.001×. */
export const COORD_LIMIT = 100_000;

export function clampCoord(n: number): number {
  return Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, n));
}

export function isLinker(el: BoardEl): el is LinkerEl {
  return el.t === "line" || el.t === "arrow";
}

export function isShape(el: BoardEl): el is ShapeEl {
  return (SHAPE_KINDS as string[]).includes(el.t);
}

export function hasStyle(el: BoardEl): el is ShapeEl | LinkerEl | DrawEl {
  return isShape(el) || isLinker(el) || el.t === "draw";
}

export function cloneScene(scene: BoardScene): BoardScene {
  return {
    header: { ...scene.header, vp: { ...scene.header.vp } },
    els: scene.els.map((el) => structuredClone(el)),
  };
}

export function findEl(scene: BoardScene, id: string): BoardEl | undefined {
  return scene.els.find((e) => e.id === id);
}

/** Frame children are resolved by back-reference (`fr`), so a frame and its
 *  contents can never disagree about membership. */
export function childrenOf(scene: BoardScene, frameId: string): BoardEl[] {
  return scene.els.filter((e) => e.fr === frameId);
}

export function textOf(el: BoardEl): string {
  if (el.t === "text" || el.t === "sticky" || el.t === "mind") return el.tx;
  if (isLinker(el)) return el.lb?.tx ?? "";
  if (isShape(el)) return el.lb?.tx ?? "";
  return "";
}

export function setTextOf(el: BoardEl, text: string): void {
  if (el.t === "text" || el.t === "sticky" || el.t === "mind") el.tx = text;
  else if (isLinker(el)) {
    if (text) el.lb = { tx: text, sz: el.lb?.sz ?? 13 };
    else delete el.lb;
  } else if (isShape(el)) {
    if (text) el.lb = { ...el.lb, tx: text, sz: el.lb?.sz ?? 14, al: el.lb?.al ?? "c" };
    else delete el.lb;
  }
}
