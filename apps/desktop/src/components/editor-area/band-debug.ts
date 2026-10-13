/**
 * Geometry probe for the two states of a band: the rendered HTML you read and
 * the nested CodeMirror you type in. Off unless
 * `localStorage.setItem("pensee.bandDebug", "1")`.
 *
 * It exists because "the caption grows / the caret vanishes when I click in" is
 * a claim about numbers, and the two-state box contract (PRD 2.9) can only be
 * checked by reading them: same width, same font metrics, same visual line
 * count, and a nested view that actually holds focus. Guessing which CSS rule
 * won is how 288px of phantom padding survived a whole afternoon.
 *
 * Every number here is descriptive. Nothing in this file changes layout.
 */

import type { EditorView } from "@codemirror/view";

export function bandDebugEnabled(): boolean {
  try {
    return localStorage.getItem("pensee.bandDebug") === "1";
  } catch {
    // Private mode / disabled storage: the probe is a debug aid, never a hard
    // dependency of editing.
    return false;
  }
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Metrics that decide where text wraps. If any of these differ between the
 *  two states, the line count differs, and a differing line count IS the gap. */
function textMetrics(el: Element): Record<string, string> {
  const s = getComputedStyle(el);
  return {
    fontSize: s.fontSize,
    fontFamily: s.fontFamily.split(",")[0] ?? "",
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    wordSpacing: s.wordSpacing,
    whiteSpace: s.whiteSpace,
    wordBreak: s.wordBreak,
    overflowWrap: s.overflowWrap,
    padding: s.padding,
    margin: s.margin,
    width: s.width,
    boxSizing: s.boxSizing,
  };
}

/** Visual line boxes of everything inside `el`, via the range's client rects.
 *  Counts what the eye counts — soft wraps included — which `.cm-line` does
 *  not: one source line can be four wrapped rows. */
function lineBoxes(el: Element): { lines: number; left: number; right: number; width: number } {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0.5 && rect.height > 0.5);
  if (!rects.length) return { lines: 0, left: 0, right: 0, width: 0 };
  const tops = new Set(rects.map((rect) => Math.round(rect.top)));
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  return { lines: tops.size, left: r2(left), right: r2(right), width: r2(right - left) };
}

function box(el: Element): Record<string, number> {
  const rect = el.getBoundingClientRect();
  return { w: r2(rect.width), h: r2(rect.height), left: r2(rect.left), top: r2(rect.top) };
}

function describe(node: Node | null): string {
  if (!(node instanceof HTMLElement)) return String(node);
  const cls =
    node.className && typeof node.className === "string"
      ? `.${node.className.trim().split(/\s+/).join(".")}`
      : "";
  return `${node.tagName.toLowerCase()}${cls}`;
}

export interface BandSnapshot {
  band: string;
  box: Record<string, number>;
  metrics: Record<string, string>;
  text: { lines: number; left: number; right: number; width: number };
}

/** Read the rendered band. Call before it is swapped out, or there is nothing
 *  left to compare the editor against. */
export function captureRenderedBand(bandEl: HTMLElement): BandSnapshot | null {
  if (!bandDebugEnabled()) return null;
  const first = bandEl.firstElementChild ?? bandEl;
  return {
    band: bandEl.dataset.wrBand ?? "?",
    box: box(bandEl),
    metrics: textMetrics(first),
    text: lineBoxes(bandEl),
  };
}

/** Read the editor that replaced it, then read it again once the dust settles.
 *  The second sample is not paranoia: a nested view that loses focus one tick
 *  after mount looks identical in the first frame and has no caret in the
 *  second. */
export function reportBandEdit(
  before: BandSnapshot | null,
  host: HTMLElement,
  inner: EditorView,
  outer: EditorView,
): void {
  if (!before) return;
  const sample = (label: string) => {
    if (!host.isConnected) {
      // eslint-disable-next-line no-console
      console.log(`[band ${label}] editor already torn down — it closed on its own`);
      return;
    }
    const editorEl = inner.dom;
    const scroller = editorEl.querySelector(".cm-scroller");
    const content = inner.contentDOM;
    const cursor = editorEl.querySelector(".cm-cursor");
    const after: BandSnapshot = {
      band: before.band,
      box: box(host),
      metrics: textMetrics(content),
      text: lineBoxes(content),
    };
    // eslint-disable-next-line no-console
    console.log(`[band ${label}] ${before.band}`, {
      "1 height": {
        rendered: before.box.h,
        editing: after.box.h,
        delta: r2((after.box.h ?? 0) - (before.box.h ?? 0)),
      },
      "2 width": {
        renderedBox: before.box.w,
        editingHost: after.box.w,
        scrollerClient: scroller ? r2(scroller.clientWidth) : null,
        contentBox: r2(content.getBoundingClientRect().width),
        // A scrollWidth wider than clientWidth means the text is laid out at a
        // width the box then clips — the "cut off mid-word" look.
        scrollerScroll: scroller ? r2(scroller.scrollWidth) : null,
        clipped: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : null,
      },
      "3 text": { rendered: before.text, editing: after.text },
      "4 metrics rendered": before.metrics,
      "5 metrics editing": after.metrics,
      "6 caret": {
        innerHasFocus: inner.hasFocus,
        cmFocusedClass: editorEl.classList.contains("cm-focused"),
        outerHasFocus: outer.hasFocus,
        activeElement: describe(document.activeElement),
        windowFocused: document.hasFocus(),
        caretColor: getComputedStyle(content).caretColor,
        cursorEl: cursor ? { display: getComputedStyle(cursor).display, ...box(cursor) } : null,
        selection: `${inner.state.selection.main.from}-${inner.state.selection.main.to}`,
      },
    });
  };
  requestAnimationFrame(() => requestAnimationFrame(() => sample("mounted")));
  window.setTimeout(() => sample("settled +400ms"), 400);
}
