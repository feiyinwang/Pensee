import DOMPurify from "dompurify";
import { detectType, load, parse, render, supports } from "pele/lazy";
import type { BoardEl, ChartEl } from "./board-model";
import { arcChart } from "./board-arc-charts";
import { type ChartSpec, chartFor } from "../pele-charts";

// A chart card on a board (SPECs/board-pictures-spec.md#chart-cards): Pele
// draws its Mermaid text as SVG, nested in the card. Pele colours everything
// through `--pele-*` variables, and the card sets them from the board's own
// colour tokens, so the chart follows the board's palette and theme in the
// editor, in the talk box and in the `.board.svg` file a note shows as an
// image (which carries those tokens in its own <style>).
//
// Pele loads each diagram type's renderer on first use. A render before then
// draws "Drawing…" and asks for the type; `onChartsReady` listeners redraw
// once it lands, and `loadCharts` lets a writer wait for it first.

/** Pele's variables, from the board's tokens. */
export const CHART_INKS = [
  "--pele-bg:var(--wr-board-surface)",
  "--pele-fg:var(--wr-board-ink)",
  "--pele-muted:var(--wr-board-muted)",
  "--pele-line:var(--wr-board-muted)",
  "--pele-surface:var(--wr-board-surface)",
  "--pele-surface-alt:var(--wr-board-frame-bg)",
  "--pele-border:var(--wr-board-muted)",
  "--pele-accent:var(--wr-board-blue)",
  "--pele-radius:8px",
  "--pele-title-weight:500",
  "--pele-series-1:var(--wr-board-blue)",
  "--pele-series-2:var(--wr-board-purple)",
  "--pele-series-3:var(--wr-board-orange)",
  "--pele-series-4:var(--wr-board-green)",
  "--pele-series-5:var(--wr-board-red)",
  "--pele-series-6:var(--wr-board-yellow)",
  "--pele-series-7:var(--wr-board-pink)",
  "--pele-series-8:var(--wr-board-muted)",
].join(";");

type Drawn = { svg: string } | { error: string };

const drawn = new Map<string, Drawn>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

/** Ids inside one chart (markers, gradients) must not collide with another's. */
function idPrefix(src: string): string {
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  return `c${(h >>> 0).toString(36)}`;
}

/** A bar or line chart is drawn 700×500 by default, its labels 14px: on a
 *  card that small words shrink to nothing. Drawn smaller, its words read
 *  at the size of the cards around it. A chart that sets its own size keeps it. */
const XY_SIZE = '%%{init: {"xyChart": {"width": 440, "height": 300}}}%%\n';
const sized = (src: string): string =>
  /^\s*xychart/.test(src) && !/xyChart/.test(src) ? XY_SIZE + src : src;

/** Pele measures labels to size its shapes, in the font they're drawn in. */
function uiFont(): string {
  if (typeof document === "undefined" || !document.body) return "sans-serif";
  return getComputedStyle(document.body).fontFamily || "sans-serif";
}

function loadType(src: string): Promise<void> {
  const type = detectType(src);
  if (!type) return Promise.resolve();
  let pending = loading.get(type);
  if (!pending) {
    pending = load(type).then(
      () => {
        loading.delete(type);
        for (const fn of listeners) fn();
      },
      (error: unknown) => {
        loading.delete(type);
        console.error(`[board] chart type ${type} didn't load:`, error);
      },
    );
    loading.set(type, pending);
  }
  return pending;
}

/** The chart's SVG markup or Pele's message; `null` while its type loads. */
export function chartDrawing(src: string): Drawn | null {
  const cached = drawn.get(src);
  if (cached) return cached;
  if (!detectType(src)) return { error: "Unknown diagram type." };
  if (!supports(src)) {
    void loadType(src);
    return null;
  }
  let result: Drawn;
  try {
    const model = parse(sized(src));
    // Arc draws the charts it has (bar, line, donut); Pele draws the rest.
    const svg =
      arcChart(model) ??
      render(model, { fontFamily: uiFont(), idPrefix: idPrefix(src), responsive: false }).svg;
    // Board files are untrusted input: the chart text comes from the file.
    result = { svg: DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }) };
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }
  drawn.set(src, result);
  return result;
}

/** Words Pele writes on a filled shape (a pie slice's share) in its
 *  background colour: they take the light one of the theme's surface and ink
 *  instead (`--wr-board-flip` is 1 in dark mode), so they read on the fill in
 *  both themes, while boxes drawn in the background colour stay the surface. */
export const ON_FILL =
  "color-mix(in oklab,var(--wr-board-ink) calc(var(--wr-board-flip) * 100%),var(--wr-board-surface))";

/**
 * Arc's look for what Pele draws (the same treatment a Mermaid block gets in
 * a note, mermaid-canvas.css), in the board's tokens: neutral raised shapes
 * with a hairline ring, a series tint by section, quadrant or period, 8px
 * corners, quiet labels, 1.5px round lines. Written into the chart, so the
 * file carries it too.
 */
export const PELE_ARC_STYLE = [
  ".wr-board-chart .pele [data-hue='1']{--hue:var(--wr-board-blue)}",
  ".wr-board-chart .pele [data-hue='2']{--hue:var(--wr-board-purple)}",
  ".wr-board-chart .pele [data-hue='3']{--hue:var(--wr-board-orange)}",
  ".wr-board-chart .pele [data-hue='4']{--hue:var(--wr-board-green)}",
  ".wr-board-chart .pele :is(.pele-node,.pele-actor,.pele-state,.pele-class,.pele-entity,.pele-task,.pele-period,.pele-service,.pele-requirement,.pele-element,.pele-usecase,.pele-wardley-component)>:is(rect,path,polygon,ellipse):not(.pele-divider):not(.pele-er-divider):not(.pele-marker){fill:color-mix(in oklab,var(--hue,var(--wr-board-ink)) var(--tint,4%),var(--wr-board-surface));stroke:color-mix(in oklab,var(--hue,var(--wr-board-ink)) var(--ring,14%),transparent);stroke-width:1px}",
  ".wr-board-chart .pele [data-hue]{--tint:12%;--ring:55%}",
  ".wr-board-chart .pele :is(.pele-divider,.pele-er-divider){stroke:color-mix(in oklab,var(--wr-board-ink) 14%,transparent)}",
  ".wr-board-chart .pele path:is(.pele-edge,.pele-track,.pele-lifeline){stroke:color-mix(in oklab,var(--wr-board-ink) 40%,transparent);stroke-width:1.5px;stroke-linecap:round;stroke-linejoin:round}",
  ".wr-board-chart .pele .pele-marker{fill:color-mix(in oklab,var(--wr-board-ink) 40%,transparent);stroke:none}",
  ".wr-board-chart .pele .pele-edge-label :is(rect,path){fill:var(--wr-board-surface);stroke:color-mix(in oklab,var(--wr-board-ink) 14%,transparent)}",
  ".wr-board-chart .pele :is(text.pele-edge-label,.pele-edge-label text){fill:var(--wr-board-muted)}",
  ".wr-board-chart .pele .pele-cluster>:is(rect,path){fill:color-mix(in oklab,var(--wr-board-ink) 3%,transparent);stroke:color-mix(in oklab,var(--wr-board-ink) 14%,transparent);stroke-dasharray:3 4}",
  ".wr-board-chart .pele :is(.pele-cluster-label,.pele-section-label,.pele-axis-label text,.pele-wardley-axis-label,.pele-wardley-stage-label){fill:var(--wr-board-muted);font-weight:500}",
  ".wr-board-chart .pele .pele-title{fill:var(--wr-board-ink);font-weight:500}",
  ".wr-board-chart .pele.pele-gantt .pele-task>:is(rect,path){--hue:var(--wr-board-blue);--tint:70%;--ring:90%}",
  ".wr-board-chart .pele .pele-quadrant>rect{fill:color-mix(in oklab,var(--hue) 7%,var(--wr-board-surface));stroke:color-mix(in oklab,var(--hue) 22%,transparent)}",
  ".wr-board-chart .pele circle:is(.pele-point,.pele-dot){fill:var(--wr-board-blue);stroke:var(--wr-board-surface);stroke-width:3px}",
  ".wr-board-chart .pele .pele-venn-set{fill-opacity:.12;stroke-width:2px}",
  ".wr-board-chart .pele .pele-curve{fill-opacity:.1;stroke-width:2px;stroke-linejoin:round}",
  // Hovering a shape lights it, and an arrow brightens (live layers only: a
  // still picture has no pointer).
  ".wr-board-chart .pele :is(.pele-node,.pele-actor,.pele-state,.pele-class,.pele-entity,.pele-task,.pele-period,.pele-service,.pele-requirement,.pele-element,.pele-usecase,.pele-wardley-component,.pele-quadrant):hover>:is(rect,path,polygon,ellipse):not(.pele-divider):not(.pele-er-divider):not(.pele-marker){--tint:18%;stroke:color-mix(in oklab,var(--hue,var(--wr-board-blue)) 80%,transparent);transition:fill .15s ease-out,stroke .15s ease-out}",
  ".wr-board-chart .pele path.pele-edge:hover{stroke:color-mix(in oklab,var(--wr-board-ink) 80%,transparent);stroke-width:2.5px}",
].join("");

/** Arc tints by category: a section's shapes share a series hue, and each
 *  quadrant and timeline period takes one (the `data-hue` PELE_ARC_STYLE reads). */
export function tintChart(svg: Element): void {
  svg.querySelectorAll("[class*='pele-section-']").forEach((g) => {
    const n = Number(/pele-section-(\d+)/.exec(g.getAttribute("class") ?? "")?.[1] ?? 0);
    g.setAttribute("data-hue", String((n % 4) + 1));
  });
  svg
    .querySelectorAll(".pele-quadrant, .pele-period")
    .forEach((g, i) => g.setAttribute("data-hue", String((i % 4) + 1)));
}

/** Space between a chart card's edge and its drawing. */
export const CHART_PAD = 16;

/** The card an Arc chart needs live, for the ones drawn still by Pele. */
const LIVE_SIZE: Record<string, [number, number]> = {
  sankey: [620, 380],
  radar: [460, 480],
  treemap: [560, 380],
  tree: [380, 340],
  kanban: [860, 480],
};

/**
 * Sizes chart cards to their drawings (drawn at their own scale, so a chart's
 * words read like the cards' around it), keeping each card's centre. Cards
 * whose type hasn't loaded are left as they are. Returns whether any changed.
 */
export function fitCharts(els: BoardEl[]): boolean {
  let changed = false;
  for (const el of els) {
    if (el.t !== "chart") continue;
    const drawing = chartDrawing(el.src);
    if (!drawing || "error" in drawing) continue;
    const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(drawing.svg);
    if (!box) continue;
    // An Arc chart with no still drawing of its own takes the room its live
    // component needs; the still picture is fitted inside.
    const live = LIVE_SIZE[arcSpec(el.src)?.chart ?? ""];
    const w = live?.[0] ?? Math.round(Number(box[1]) + CHART_PAD * 2);
    const h = live?.[1] ?? Math.round(Number(box[2]) + CHART_PAD * 2);
    if (w === el.w && h === el.h) continue;
    el.x = Math.round(el.x + (el.w - w) / 2);
    el.y = Math.round(el.y + (el.h - h) / 2);
    el.w = w;
    el.h = h;
    changed = true;
  }
  return changed;
}

const specs = new Map<string, ChartSpec | null>();

/** The live Arc component a chart is, when Arc has one (bar, line, donut,
 *  sankey, radar, treemap, tree view, kanban); null otherwise, or while its
 *  type loads. */
export function arcSpec(src: string): ChartSpec | null {
  if (specs.has(src)) return specs.get(src)!;
  if (!detectType(src) || !supports(src)) return null;
  let spec: ChartSpec | null = null;
  try {
    spec = chartFor(parse(src));
  } catch {
    // Pele's message shows on the card's drawing; there is no live chart.
  }
  specs.set(src, spec);
  return spec;
}

/** Called when a chart type finishes loading; returns the unsubscribe. */
export function onChartsReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Waits until every chart in `els` can be drawn. */
export async function loadCharts(els: BoardEl[]): Promise<void> {
  await Promise.all(
    els
      .filter((el): el is ChartEl => el.t === "chart" && !supports(el.src))
      .map((el) => loadType(el.src)),
  );
}

/** The Mermaid diagram types a board draws as a chart card. */
export const isChartSource = (src: string): boolean => detectType(src) !== null;
