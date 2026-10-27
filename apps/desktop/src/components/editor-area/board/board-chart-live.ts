import {
  CHART_INKS,
  CHART_PAD,
  ON_FILL,
  PELE_ARC_STYLE,
  arcSpec,
  chartDrawing,
  tintChart,
} from "./board-chart";
import type { ChartSpec } from "../pele-charts";

// Live chart cards (SPECs/board-pictures-spec.md#live-charts). A board file is
// a still picture: a note shows it as an image and other apps open it. Where
// Pensée shows a board (the board editor, the talk box, a note's board
// preview) each chart card gets a live layer laid exactly over its drawing:
// - a chart Arc has (bar, line, donut, sankey, radar, treemap, tree view,
//   kanban) is the real Arc component, with its hover readouts, legends and
//   toggles;
// - any other diagram is its drawing, inline, so hovering lights the shape
//   under the pointer and its connections.
//
// Hovering always reaches the chart. A press reaches it only when
// `interactive(id)` says so (on a board, once the card is selected); otherwise
// it goes to whatever is under the layer (the board, to select or drag the
// card; the note's image or the talk box, to open the board). A double-click
// always goes underneath, so it still opens the chart's text.

export interface LiveCard {
  id: string;
  src: string;
  /** The card's size in board units. */
  w: number;
  h: number;
}

/** Where a card sits in the layer's container, in px, and its scale. */
export type Place = { x: number; y: number; scale: number } | null;

interface Mounted {
  el: HTMLDivElement;
  src: string;
  unmount: () => void;
}

const PASSED = ["pointerdown", "pointerup", "mousedown", "mouseup", "click"] as const;

let chartView: Promise<typeof import("../pele-chart-view")> | null = null;

export class ChartLayer {
  private readonly layer: HTMLDivElement;
  private readonly mounted = new Map<string, Mounted>();

  constructor(
    container: HTMLElement,
    private readonly interactive: (id: string) => boolean = () => false,
  ) {
    this.layer = document.createElement("div");
    this.layer.className = "wr-chart-layer";
    container.append(this.layer);
  }

  /** Mounts new cards, drops gone ones, and lays every card over its drawing. */
  sync(cards: LiveCard[], place: (id: string) => Place): void {
    const live = new Set<string>();
    for (const card of cards) {
      const at = place(card.id);
      if (!at) continue;
      live.add(card.id);
      let m: Mounted | null | undefined = this.mounted.get(card.id);
      if (m && m.src !== card.src) {
        this.drop(card.id);
        m = undefined;
      }
      if (!m) m = this.mount(card);
      if (!m) continue;
      m.el.style.width = `${card.w}px`;
      m.el.style.height = `${card.h}px`;
      m.el.style.transform = `translate(${at.x}px, ${at.y}px) scale(${at.scale})`;
      // A card that takes presses (selected) says so: the board's own
      // selection outline is under this layer.
      m.el.toggleAttribute("data-selected", this.interactive(card.id));
    }
    for (const id of this.mounted.keys()) if (!live.has(id)) this.drop(id);
  }

  destroy(): void {
    for (const id of this.mounted.keys()) this.drop(id);
    this.layer.remove();
  }

  private drop(id: string): void {
    const m = this.mounted.get(id);
    if (!m) return;
    m.unmount();
    m.el.remove();
    this.mounted.delete(id);
  }

  private mount(card: LiveCard): Mounted | null {
    const spec = arcSpec(card.src);
    const drawing = spec ? null : chartDrawing(card.src);
    // Not ready yet (its type is loading) or a mistake: the still drawing shows.
    if (!spec && (!drawing || "error" in drawing)) return null;
    const el = document.createElement("div");
    el.className = "wr-chart-live";
    el.dataset.chart = card.id;
    const inner = document.createElement("div");
    inner.className = "wr-chart-live-inner";
    inner.style.padding = `${CHART_PAD}px`;
    el.append(inner);
    this.passThrough(el, card.id);
    this.layer.append(el);
    const m: Mounted = { el, src: card.src, unmount: () => {} };
    if (spec) mountArc(inner, spec, m);
    else if (drawing && "svg" in drawing) inner.append(inlineDrawing(drawing.svg));
    this.mounted.set(card.id, m);
    return m;
  }

  /** Presses go underneath unless the card takes them; double-clicks always do. */
  private passThrough(el: HTMLDivElement, id: string): void {
    const pass = (e: MouseEvent) => {
      if (e.type !== "dblclick" && this.interactive(id)) return;
      e.stopPropagation();
      e.preventDefault();
      el.style.pointerEvents = "none";
      const below = document.elementFromPoint(e.clientX, e.clientY);
      el.style.pointerEvents = "";
      if (!below) return;
      const Ctor = e instanceof PointerEvent ? PointerEvent : MouseEvent;
      below.dispatchEvent(new Ctor(e.type, e));
    };
    for (const type of [...PASSED, "dblclick"])
      el.addEventListener(type, pass as EventListener, true);
  }
}

function mountArc(inner: HTMLDivElement, spec: ChartSpec, m: Mounted): void {
  let gone = false;
  m.unmount = () => {
    gone = true;
  };
  chartView ??= import("../pele-chart-view");
  void chartView
    .then(({ mountChart }) => {
      if (gone) return;
      const unmount = mountChart(inner, spec);
      m.unmount = unmount;
    })
    .catch((error: unknown) => console.error("[board] live chart didn't load:", error));
}

/** A Pele drawing, inline and in Arc's look, so hovering it lights its shapes. */
function inlineDrawing(markup: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "wr-board-chart wr-chart-live-drawing";
  box.setAttribute("style", CHART_INKS);
  const style = document.createElement("style");
  style.textContent = PELE_ARC_STYLE;
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  for (const t of svg.querySelectorAll('text[fill="var(--_bg)"]')) t.setAttribute("fill", ON_FILL);
  tintChart(svg);
  box.append(style, svg);
  return box;
}

/** The chart cards of a scene, for `ChartLayer.sync`. */
export function liveCards(
  els: readonly { id: string; t: string; w: number; h: number; src?: string }[],
): LiveCard[] {
  return els
    .filter((el) => el.t === "chart" && el.src)
    .map((el) => ({ id: el.id, src: el.src!, w: el.w, h: el.h }));
}

/** A card's place from its drawn card rect in the DOM (the board editor and
 *  the talk box draw boards as inline SVG), relative to `container`. */
export function placeFromDom(root: ParentNode, container: HTMLElement, cards: LiveCard[]) {
  const origin = container.getBoundingClientRect();
  const byId = new Map(cards.map((c) => [c.id, c]));
  return (id: string): Place => {
    const rect = root.querySelector(`[data-el="${CSS.escape(id)}"] .wr-board-chart-card`);
    const card = byId.get(id);
    if (!rect || !card) return null;
    const r = rect.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left - origin.left, y: r.top - origin.top, scale: r.width / card.w };
  };
}
