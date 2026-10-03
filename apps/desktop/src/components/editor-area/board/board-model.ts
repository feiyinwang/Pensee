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

export type ColorToken =
  | "ink"
  | "muted"
  | "accent"
  | "red"
  | "orange"
  | "green"
  | "blue"
  | "purple"
  | "none";

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

export type ElementType = ShapeKind | "text" | "sticky" | LinkerKind | "frame" | "image";

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
}

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

export type BoardEl = ShapeEl | TextEl | StickyEl | LinkerEl | FrameEl | ImageEl;

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

const DEFAULT_STYLE: Style = { s: "ink", f: "none", w: 1.5, d: "solid", r: 8 };

export function defaultStyle(over: Partial<Style> = {}): Style {
  return { ...DEFAULT_STYLE, ...over };
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
    s: str(o.s, DEFAULT_STYLE.s) as ColorToken,
    f: str(o.f, DEFAULT_STYLE.f) as ColorToken,
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
  if (typeof o.c === "string" && o.c !== "ink") label.c = o.c as ColorToken;
  return label;
}

function parseBinding(raw: unknown): Binding | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const el = str(o.el, "");
  if (!el) return undefined;
  return { el, fx: num(o.fx, 0), gap: num(o.gap, 6) };
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
      c: str(o.c, "ink") as ColorToken,
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
    return {
      ...base,
      t,
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
    return { ...base, t: t as ShapeKind, st: parseStyle(o.st), lb: parseLabel(o.lb) };
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
      if (el.b1) o.b1 = { el: el.b1.el, fx: Math.round(el.b1.fx * 1000) / 1000, gap: el.b1.gap };
      if (el.b2) o.b2 = { el: el.b2.el, fx: Math.round(el.b2.fx * 1000) / 1000, gap: el.b2.gap };
      const defEnd = el.t === "arrow" ? "triangle" : "none";
      if (el.hd.s !== "none" || el.hd.e !== defEnd) o.hd = el.hd;
      const st = pruneStyle(el.st);
      if (st) o.st = st;
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

export function clampZoom(z: number): number {
  return Math.min(5, Math.max(0.1, z));
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

export function hasStyle(el: BoardEl): el is ShapeEl | LinkerEl {
  return isShape(el) || isLinker(el);
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
  if (el.t === "text" || el.t === "sticky") return el.tx;
  if (isShape(el)) return el.lb?.tx ?? "";
  return "";
}

export function setTextOf(el: BoardEl, text: string): void {
  if (el.t === "text" || el.t === "sticky") el.tx = text;
  else if (isShape(el)) {
    if (text) el.lb = { ...el.lb, tx: text, sz: el.lb?.sz ?? 14, al: el.lb?.al ?? "c" };
    else delete el.lb;
  }
}
