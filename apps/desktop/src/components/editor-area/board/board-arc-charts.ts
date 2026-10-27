// Arc's charts, drawn still for a board's chart card (SPECs/board-pictures-spec.md#chart-cards):
// the bar, line and donut charts as Arc draws them in a note (a readout over
// the plot, hairline grids, a right-hand value axis, the series in Arc's
// soft step of the accent), as one SVG string from Pele's parsed model. A
// board is a file a note shows as an image and other apps open, so these
// carry no script and no hover: the look, not the interaction. Colours are
// the board's tokens, so they follow its palette and theme.
//
// Each drawer returns null when the model isn't one it draws (a mix of bars
// and lines, say), and Pele draws it instead.

/* eslint-disable @typescript-eslint/no-explicit-any -- Pele's parsed models are untyped data. */

const ACCENT = "var(--wr-board-ink)";
/** The marks' accent: the board's first series hue, as the donut's and the
 *  other diagrams' tints are, so every chart on a board carries colour. */
const MARK = "var(--wr-board-blue)";
/** Arc's bar: a soft step of the accent, a lighter mix on a dark surface. */
const BAR = `color-mix(in oklab,${MARK} calc(62% + var(--wr-board-flip) * 14%),var(--wr-board-surface))`;
const GRID = `color-mix(in oklab,${ACCENT} 9%,transparent)`;
const BASELINE = `color-mix(in oklab,${ACCENT} 22%,transparent)`;
const MUTED = "var(--wr-board-muted)";
/** Arc's line series, in the board's series hues. */
const LINES = [MARK, "var(--wr-board-purple)", "var(--wr-board-orange)", "var(--wr-board-green)"];
/** Arc's donut: its four series hues, then neutral steps. */
const SLICES = [
  "var(--wr-board-blue)",
  "var(--wr-board-purple)",
  "var(--wr-board-orange)",
  "var(--wr-board-green)",
  `color-mix(in oklab,${ACCENT} 46%,var(--wr-board-surface))`,
  `color-mix(in oklab,${ACCENT} 26%,var(--wr-board-surface))`,
];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
const fmt = (n: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n);

function text(
  x: number,
  y: number,
  body: string,
  o: { size?: number; fill?: string; weight?: number; anchor?: string } = {},
): string {
  return `<text x="${num(x)}" y="${num(y)}" font-size="${o.size ?? 12}" fill="${o.fill ?? MUTED}"${o.weight ? ` font-weight="${o.weight}"` : ""}${o.anchor ? ` text-anchor="${o.anchor}"` : ""} style="font-variant-numeric:tabular-nums">${esc(body)}</text>`;
}

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="wr-arc-chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

/** A round top for the value axis: 1, 2 or 5 times a power of ten, in four steps. */
function scaleFor(peak: number): { top: number; ticks: number[] } {
  if (peak <= 0) return { top: 1, ticks: [0, 1] };
  const raw = peak / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { top, ticks };
}

/** The readout Arc puts over a plot: a label, the value large, what it covers. */
function readout(label: string, value: string, when: string): string {
  return (
    text(0, 14, label, { size: 13 }) +
    text(0, 48, value, { size: 30, weight: 500, fill: ACCENT }) +
    (when ? text(0, 70, when, { size: 13, fill: MUTED }) : "")
  );
}

const W = 440;
const PLOT_TOP = 92;
const GUTTER = 40;
const AXIS = 24;

function plotFrame(
  h: number,
  ticks: number[],
  top: number,
): { y: (v: number) => number; body: string } {
  const bottom = h - AXIS;
  const y = (v: number) => bottom - (v / top) * (bottom - PLOT_TOP);
  let body = "";
  for (const t of ticks) {
    const ty = y(t);
    body += `<line x1="0" x2="${W - GUTTER}" y1="${num(ty)}" y2="${num(ty)}" stroke="${t === 0 ? BASELINE : GRID}" stroke-width="1" shape-rendering="crispEdges"/>`;
    body += text(W - GUTTER + 10, ty + 4, fmt(t), { size: 11 });
  }
  return { y, body };
}

function categoriesOf(m: any): string[] {
  return (m.xAxis?.categories ?? []).map(String);
}

function valuesOf(plot: any, cats: string[]): number[] {
  const data: [string, number][] = plot.data ?? [];
  return cats.map((c, i) => Number((data.find((d) => d[0] === c) ?? data[i] ?? [c, 0])[1]) || 0);
}

/** Arc's bar chart: the average as the readout, bars with round tops. */
function barChart(m: any): string | null {
  const cats = categoriesOf(m);
  const plots: any[] = m.plots ?? [];
  if (plots.length !== 1 || plots[0].type !== "bar" || !cats.length) return null;
  const values = valuesOf(plots[0], cats);
  const h = 300;
  const { top, ticks } = scaleFor(Math.max(...values));
  const { y, body: frame } = plotFrame(h, ticks, top);
  const band = (W - GUTTER) / cats.length;
  const bw = Math.min(Math.max(band * 0.56, 6), 48);
  const r = Math.min(4, bw / 2);
  let bars = "";
  cats.forEach((c, i) => {
    const x = band * i + (band - bw) / 2;
    const top = y(values[i]);
    const base = y(0);
    const hgt = base - top;
    if (hgt > 0) {
      const rr = Math.min(r, hgt);
      bars += `<path d="M${num(x)} ${num(base)}V${num(top + rr)}Q${num(x)} ${num(top)} ${num(x + rr)} ${num(top)}H${num(x + bw - rr)}Q${num(x + bw)} ${num(top)} ${num(x + bw)} ${num(top + rr)}V${num(base)}Z" fill="${BAR}"/>`;
    }
    bars += text(band * i + band / 2, h - 6, c, { size: 11, anchor: "middle" });
  });
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const label = m.yAxis?.title ? `Average ${String(m.yAxis.title).toLowerCase()}` : "Average";
  return svg(W, h, readout(label, fmt(avg), String(m.title ?? "")) + frame + bars);
}

/** Arc's line chart: the first series in the accent over a faint area, the
 *  rest in neutral steps, each ending on a dot. */
function lineChart(m: any): string | null {
  const cats = categoriesOf(m);
  const plots: any[] = m.plots ?? [];
  if (!plots.length || !cats.length || plots.some((p) => p.type !== "line")) return null;
  const series = plots.map((p) => valuesOf(p, cats));
  const h = 300;
  const { top, ticks } = scaleFor(Math.max(...series.flat()));
  const { y, body: frame } = plotFrame(h, ticks, top);
  const step = cats.length > 1 ? (W - GUTTER - 16) / (cats.length - 1) : 0;
  const x = (i: number) => 8 + step * i;
  let lines = "";
  series.forEach((vals, s) => {
    const color = LINES[Math.min(s, LINES.length - 1)];
    const pts = vals.map((v, i) => `${num(x(i))} ${num(y(v))}`);
    if (s === 0)
      lines += `<path d="M${pts.join("L")}L${num(x(vals.length - 1))} ${num(y(0))}L${num(x(0))} ${num(y(0))}Z" fill="color-mix(in oklab,${color} 9%,transparent)"/>`;
    lines += `<path d="M${pts.join("L")}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    const last = vals.length - 1;
    lines += `<circle cx="${num(x(last))}" cy="${num(y(vals[last]))}" r="3.5" fill="${color}" stroke="var(--wr-board-surface)" stroke-width="2"/>`;
  });
  cats.forEach((c, i) => (lines += text(x(i), h - 6, c, { size: 11, anchor: "middle" })));
  const first = series[0];
  const latest = first[first.length - 1];
  const named = plots.map((p, i) => String(p.title || (plots.length > 1 ? `Series ${i + 1}` : "")));
  const label = named[0] || "Latest";
  return svg(W, h, readout(label, fmt(latest), String(m.title ?? "")) + frame + lines);
}

/** Arc's donut: a ring with hairline gaps, the total in its centre, and a
 *  legend of each slice's value and share beside it. */
function donutChart(m: any): string | null {
  const entries: [string, number][] = (
    m.sections instanceof Map ? [...m.sections.entries()] : Object.entries(m.sections ?? {})
  ).map(([k, v]: [string, unknown]) => [String(k), Number(v) || 0]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!entries.length || total <= 0) return null;
  const size = 200;
  const rOut = 96;
  const rIn = 62;
  const cx = size / 2;
  const cy = size / 2 + 24;
  let a0 = -Math.PI / 2;
  let ring = "";
  entries.forEach(([, v], i) => {
    const a1 = a0 + (v / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r: number, a: number) => `${num(cx + r * Math.cos(a))} ${num(cy + r * Math.sin(a))}`;
    const d =
      entries.length === 1
        ? `M${cx - rOut} ${cy}a${rOut} ${rOut} 0 1 0 ${rOut * 2} 0a${rOut} ${rOut} 0 1 0 ${-rOut * 2} 0ZM${cx - rIn} ${cy}a${rIn} ${rIn} 0 1 1 ${rIn * 2} 0a${rIn} ${rIn} 0 1 1 ${-rIn * 2} 0Z`
        : `M${p(rOut, a0)}A${rOut} ${rOut} 0 ${large} 1 ${p(rOut, a1)}L${p(rIn, a1)}A${rIn} ${rIn} 0 ${large} 0 ${p(rIn, a0)}Z`;
    ring += `<path d="${d}" fill="${SLICES[i % SLICES.length]}" fill-rule="evenodd" stroke="var(--wr-board-surface)" stroke-width="2"/>`;
    a0 = a1;
  });
  ring += text(cx, cy - 6, "Total", { size: 12, anchor: "middle" });
  ring += text(cx, cy + 20, fmt(total), { size: 24, weight: 500, fill: ACCENT, anchor: "middle" });
  const lx = size + 28;
  const rowH = 30;
  const top = cy - (entries.length * rowH) / 2 + rowH / 2;
  let legend = "";
  entries.forEach(([k, v], i) => {
    const ry = top + i * rowH;
    legend += `<circle cx="${lx + 5}" cy="${num(ry - 4)}" r="5" fill="${SLICES[i % SLICES.length]}"/>`;
    legend += text(lx + 20, ry, k, { size: 13, fill: ACCENT });
    legend += text(lx + 200, ry, fmt(v), { size: 13, anchor: "end" });
    legend += text(lx + 248, ry, `${Math.round((v / total) * 100)}%`, { size: 13, anchor: "end" });
  });
  const w = lx + 252;
  const h = Math.max(size + 32, top + entries.length * rowH);
  const title = m.title ? text(0, 14, String(m.title), { size: 13 }) : "";
  return svg(w, h, title + ring + legend);
}

/** Arc's drawing of a parsed Pele model, or null when Pele draws it. */
export function arcChart(model: any): string | null {
  if (model?.type === "xychart") return barChart(model) ?? lineChart(model);
  if (model?.type === "pie") return donutChart(model);
  return null;
}
