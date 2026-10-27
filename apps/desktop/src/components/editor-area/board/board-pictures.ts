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
// - a timeline is a roadmap, as Linear draws one: periods across the top,
//   each workstream a bar with its events as diamonds;
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

/** A period's column: wide enough for its milestones' labels side by side. */
const COL_MIN = 150;
const MILESTONE_W = 112;
const HEADER_H = 28;
const ROW_H = 92;
const BAR_H = 22;
const DIAMOND = 10;
const LABEL_FONT = 11;

/**
 * Mermaid `timeline`, drawn as a roadmap (Linear's): the periods across the
 * top with a dashed guide where each begins; each workstream a row, its name
 * above a thin bar spanning the periods it runs through, its events as
 * diamonds on the bar with their names under them, and the bar's last stretch
 * tinted in the row's hue. A timeline's `section`s are its workstreams; with
 * none, the whole timeline is one, named by its title.
 * `period : event : event`; a line starting with `:` adds events to the
 * period above.
 */
export function timelineToElements(source: string, measure: Measure): BoardEl[] | null {
  const lines = bodyLines(source, /^\s*timeline\b/);
  if (!lines) return null;
  let title = "";
  let section: string | null = null;
  const periods: string[] = [];
  const events: { period: number; text: string; row: string }[] = [];
  const rows: string[] = [];
  for (const line of lines) {
    const t = /^title\s+(.*)$/.exec(line);
    if (t) {
      title = t[1].trim();
      continue;
    }
    const sec = /^section\s+(.*)$/.exec(line);
    if (sec) {
      section = sec[1].trim();
      if (!rows.includes(section)) rows.push(section);
      continue;
    }
    const [head, ...rest] = line.split(":").map((x) => x.trim());
    // A period named again (in another section) is the same column.
    if (head && !periods.includes(head)) periods.push(head);
    if (!periods.length) periods.push(head);
    const period = head ? periods.indexOf(head) : (events[events.length - 1]?.period ?? 0);
    const row = section ?? (title || "Timeline");
    if (!rows.includes(row)) rows.push(row);
    for (const text of rest.filter(Boolean)) events.push({ period, text, row });
  }
  if (!periods.length) return null;

  // Columns: each period as wide as its busiest row's milestones need.
  const busiest = periods.map((_, p) =>
    Math.max(1, ...rows.map((r) => events.filter((e) => e.period === p && e.row === r).length)),
  );
  const colW = busiest.map((n) => Math.max(COL_MIN, n * MILESTONE_W + 40));
  const colX = colW.map((_, i) => colW.slice(0, i).reduce((a, b) => a + b, 0));
  const height = HEADER_H + rows.length * ROW_H + 8;

  const els: BoardEl[] = [];
  // Workstreams are named by their sections; the timeline's title goes above.
  if (title && !rows.includes(title)) {
    const width = colX[colX.length - 1] + colW[colW.length - 1];
    els.push(text(title, 0, -40, width, 16, "l"));
  }
  // The axis: each period's name, quiet, over a dashed guide where it begins.
  periods.forEach((name, i) => {
    const label = text(name.toUpperCase(), colX[i], 0, colW[i], 11, "l");
    label.c = "muted";
    label.x += 6;
    els.push(label);
    els.push({
      ...base("line", colX[i], HEADER_H - 6, 0, 0),
      t: "line",
      sh: "straight",
      pts: [
        [0, 0],
        [0, height - HEADER_H + 6],
      ],
      hd: { s: "none", e: "none" },
      st: defaultStyle({ s: "muted", d: "dashed", w: 1 }),
    } satisfies LinkerEl);
  });

  rows.forEach((row, r) => {
    const hue = HUES[r % HUES.length];
    const mine = events.filter((e) => e.row === row);
    const first = mine.length ? Math.min(...mine.map((e) => e.period)) : 0;
    const last = mine.length ? Math.max(...mine.map((e) => e.period)) : periods.length - 1;
    const y = HEADER_H + 12 + r * ROW_H;
    const x0 = colX[first] + 8;
    const x1 = colX[last] + colW[last] - 8;
    // Its name, after a dot of its hue.
    els.push({
      ...base("ellipse", x0, y + 5, 10, 10),
      t: "ellipse",
      st: defaultStyle({ f: hue, s: hue, w: 1 }),
    });
    els.push(text(row, x0 + 16, y - 1, Math.max(x1 - x0 - 16, measure(row, 14) + 8), 14, "l"));
    const barY = y + 24;
    // The track, then its last stretch in the row's hue, dashed, as a roadmap
    // draws what's still ahead.
    els.push({
      ...base("roundRect", x0, barY, x1 - x0, BAR_H),
      t: "roundRect",
      st: defaultStyle({ f: "muted-soft", s: "none", w: 1, r: 4 }),
    });
    const tail = Math.min(colW[last] - 16, (x1 - x0) * 0.45);
    els.push({
      ...base("roundRect", x1 - tail, barY, tail, BAR_H),
      t: "roundRect",
      st: defaultStyle({ f: `${hue}-soft`, s: hue, w: 1, d: "dashed", r: 4 }),
    });
    // Its events: diamonds spread across their period's stretch of the bar.
    for (let p = first; p <= last; p++) {
      const here = mine.filter((e) => e.period === p);
      here.forEach((e, k) => {
        // One milestone's width apart, centred in the period.
        const cx = colX[p] + (colW[p] - (here.length - 1) * MILESTONE_W) / 2 + k * MILESTONE_W;
        els.push({
          ...base("diamond", cx - DIAMOND / 2, barY + (BAR_H - DIAMOND) / 2, DIAMOND, DIAMOND),
          t: "diamond",
          st: defaultStyle({ f: "none", s: "muted", w: 1.25, r: 0 }),
        });
        const lw = Math.min(MILESTONE_W - 8, Math.max(measure(e.text, LABEL_FONT) + 8, 40));
        const label = text(e.text, cx - lw / 2, barY + BAR_H + 6, lw, LABEL_FONT);
        label.c = "muted";
        els.push(label);
      });
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
