import { isChartSource } from "./board-chart";
import { FRAME_TITLE_H } from "./board-geometry";
import {
  type BoardEl,
  type ChartEl,
  type FrameEl,
  type HueToken,
  type LinkerEl,
  type ShapeEl,
  type TextEl,
  defaultStyle,
  newId,
  newShapeStyle,
} from "./board-model";

// The pictures a board holds besides flowcharts and mind maps
// (SPECs/board-pictures-spec.md), as board elements from Mermaid text:
// - a matrix (`quadrantChart`) is four tinted sections with its ideas as the
//   board's blue cards, placed by their scores, and its axes as text;
// - a timeline is a card per period on an arrow, its events under it;
// - anything else (bar, line, pie, journey, sankey…) is one chart card that
//   draws itself from the text (`board-chart.ts`).
// Elements come back with the top-left at (0, 0).

type Measure = (text: string, size: number) => number;

/** The series hues, in the order Pele and the mind map use them. */
const HUES: HueToken[] = ["blue", "purple", "orange", "green"];

const base = (t: BoardEl["t"], x: number, y: number, w: number, h: number) => ({
  id: newId(),
  t,
  x: Math.round(x),
  y: Math.round(y),
  w: Math.round(w),
  h: Math.round(h),
  a: 0,
  op: 1,
});

function text(
  tx: string,
  x: number,
  y: number,
  w: number,
  sz: number,
  al: TextEl["al"] = "c",
): TextEl {
  return { ...base("text", x, y, w, sz * 1.5), t: "text", tx, sz, al, c: "ink" };
}

/** Greedy word wrap to `max` px, so a card's height can follow its words. */
function wrap(words: string, size: number, max: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, size) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function card(
  tx: string,
  x: number,
  y: number,
  w: number,
  h: number,
  sz: number,
  hue?: HueToken,
): ShapeEl {
  return {
    ...base("roundRect", x, y, w, h),
    t: "roundRect",
    st: hue ? defaultStyle({ f: `${hue}-soft`, s: hue }) : newShapeStyle(),
    ...(tx ? { lb: { tx, sz, al: "c" as const } } : {}),
  };
}

const bodyLines = (source: string, header: RegExp): string[] | null => {
  const lines = source.replace(/\r/g, "").split("\n");
  const first = lines.findIndex((l) => l.trim() && !l.trim().startsWith("%%"));
  if (first < 0 || !header.test(lines[first])) return null;
  return lines
    .slice(first + 1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("%%"));
};

/* -------------------------------------------------------------- matrix */

const QUAD_W = 180;
const QUAD_H = 140;
const QUAD_GAP = 8;
/** Room between the rows for the lower sections' names. */
const ROW_GAP = FRAME_TITLE_H + 12;
const POINT_FONT = 14;

/** Mermaid `quadrantChart`: quadrant-1 is top right, then counter-clockwise. */
export function quadrantToElements(source: string, measure: Measure): BoardEl[] | null {
  const lines = bodyLines(source, /^\s*quadrantChart\b/);
  if (!lines) return null;
  let title = "";
  const axis = { x: ["", ""], y: ["", ""] };
  const names = ["", "", "", ""];
  const points: { name: string; x: number; y: number }[] = [];
  for (const line of lines) {
    let m: RegExpExecArray | null;
    if ((m = /^title\s+(.*)$/.exec(line))) title = m[1].trim();
    else if ((m = /^([xy])-axis\s+(.*)$/.exec(line))) {
      const [low, high = ""] = m[2].split("-->").map((s) => s.trim());
      axis[m[1] as "x" | "y"] = [low, high];
    } else if ((m = /^quadrant-([1-4])\s+(.*)$/.exec(line))) names[Number(m[1]) - 1] = m[2].trim();
    // A point, its style class (`Name:::hot: [x, y]`) left out.
    else if (
      (m = /^(.+?)\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/.exec(line.replace(/:::[\w-]+/, "")))
    ) {
      points.push({ name: m[1].trim(), x: Number(m[2]), y: Number(m[3]) });
    }
  }

  const top = title ? 40 : 0;
  const left = axis.y[0] || axis.y[1] ? 32 : 0;
  const w = QUAD_W * 2 + QUAD_GAP;
  const h = QUAD_H * 2 + ROW_GAP;
  // Top left, top right, bottom left, bottom right, by quadrant number.
  const places: [number, number, number][] = [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 2],
    [1, 0, 3],
  ];
  const els: BoardEl[] = [];
  if (title) els.push(text(title, left, 0, w, 16));
  const frames: FrameEl[] = places.map(([col, row, i]) => ({
    ...base(
      "frame",
      left + col * (QUAD_W + QUAD_GAP),
      top + FRAME_TITLE_H + (1 - row) * (QUAD_H + ROW_GAP),
      QUAD_W,
      QUAD_H,
    ),
    t: "frame",
    name: names[i],
    preset: "custom",
    c: `${HUES[i]}-soft`,
  }));
  els.push(...frames);

  const area = { x: left, y: top + FRAME_TITLE_H, w, h };
  for (const p of points) {
    const x = Math.min(Math.max(p.x, 0), 1);
    const y = Math.min(Math.max(p.y, 0), 1);
    const cw = Math.min(Math.max(measure(p.name, POINT_FONT) + 20, 56), QUAD_W - 12);
    const ch = 32;
    const cx = Math.min(
      Math.max(area.x + x * area.w, area.x + cw / 2 + 4),
      area.x + area.w - cw / 2 - 4,
    );
    const cy = Math.min(
      Math.max(area.y + (1 - y) * area.h, area.y + ch / 2 + 4),
      area.y + area.h - ch / 2 - 4,
    );
    els.push(card(p.name, cx - cw / 2, cy - ch / 2, cw, ch, POINT_FONT));
  }

  const below = area.y + h + 10;
  if (axis.x[0]) els.push(text(axis.x[0], left, below, QUAD_W, 13));
  if (axis.x[1]) els.push(text(axis.x[1], left + QUAD_W + QUAD_GAP, below, QUAD_W, 13));
  // The y axis reads bottom to top, beside the rows.
  const yLabel = (tx: string, rowTop: number): TextEl => {
    const t = text(tx, 0, 0, QUAD_H, 13);
    t.x = Math.round(left / 2 - QUAD_H / 2);
    t.y = Math.round(rowTop + QUAD_H / 2 - t.h / 2);
    t.a = -Math.PI / 2;
    return t;
  };
  if (axis.y[1]) els.push(yLabel(axis.y[1], area.y));
  if (axis.y[0]) els.push(yLabel(axis.y[0], area.y + QUAD_H + ROW_GAP));
  return els;
}

/* ------------------------------------------------------------ timeline */

const COL_W = 168;
const COL_GAP = 24;
const PERIOD_H = 44;
const EVENT_FONT = 13;

/** Mermaid `timeline`: `period : event : event`, a line starting with `:`
 *  adds events to the period above; sections are left out. */
export function timelineToElements(source: string, measure: Measure): BoardEl[] | null {
  const lines = bodyLines(source, /^\s*timeline\b/);
  if (!lines) return null;
  let title = "";
  const periods: { name: string; events: string[] }[] = [];
  for (const line of lines) {
    const m = /^title\s+(.*)$/.exec(line);
    if (m) {
      title = m[1].trim();
      continue;
    }
    if (/^section\s/.test(line)) continue;
    const [head, ...rest] = line.split(":").map((s) => s.trim());
    const events = rest.filter(Boolean);
    if (!head && periods.length) periods[periods.length - 1].events.push(...events);
    else periods.push({ name: head, events });
  }
  if (!periods.length) return null;

  const els: BoardEl[] = [];
  const top = title ? 40 : 0;
  const width = periods.length * COL_W + (periods.length - 1) * COL_GAP;
  if (title) els.push(text(title, 0, 0, width, 16));
  const axisY = top + PERIOD_H + 22;
  const axis: LinkerEl = {
    ...base("arrow", -8, axisY, 0, 0),
    t: "arrow",
    sh: "straight",
    pts: [
      [0, 0],
      [width + 24, 0],
    ],
    hd: { s: "none", e: "triangle" },
    st: defaultStyle({ s: "muted" }),
  };
  els.push(axis);
  periods.forEach((p, i) => {
    const x = i * (COL_W + COL_GAP);
    const hue = HUES[i % HUES.length];
    els.push(card(p.name, x, top, COL_W, PERIOD_H, 15, hue));
    let y = axisY + 22;
    for (const event of p.events) {
      const lines = wrap(event, EVENT_FONT, COL_W - 24, measure);
      const h = Math.max(36, lines.length * EVENT_FONT * 1.35 + 18);
      const ev = card(lines.join("\n"), x, y, COL_W, h, EVENT_FONT, hue);
      ev.st = defaultStyle({ s: hue, w: 1 });
      els.push(ev);
      y += h + 10;
    }
  });
  return els;
}

/* --------------------------------------------------------------- chart */

/** Any other Mermaid diagram: one chart card, sized for its kind. */
export function chartToElements(source: string): BoardEl[] | null {
  if (!isChartSource(source)) return null;
  const pie = /^\s*pie\b/m.test(source);
  const el: ChartEl = {
    ...base("chart", 0, 0, pie ? 440 : 560, pie ? 380 : 360),
    t: "chart",
    src: source.trim(),
  };
  return [el];
}
