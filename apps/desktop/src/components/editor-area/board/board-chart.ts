import DOMPurify from "dompurify";
import { detectType, load, parse, render, supports } from "pele/lazy";
import type { BoardEl, ChartEl } from "./board-model";

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
    const svg = render(parse(sized(src)), {
      fontFamily: uiFont(),
      idPrefix: idPrefix(src),
      responsive: false,
    }).svg;
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

/** Space between a chart card's edge and its drawing. */
export const CHART_PAD = 16;

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
    const w = Math.round(Number(box[1]) + CHART_PAD * 2);
    const h = Math.round(Number(box[2]) + CHART_PAD * 2);
    if (w === el.w && h === el.h) continue;
    el.x = Math.round(el.x + (el.w - w) / 2);
    el.y = Math.round(el.y + (el.h - h) / 2);
    el.w = w;
    el.h = h;
    changed = true;
  }
  return changed;
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
