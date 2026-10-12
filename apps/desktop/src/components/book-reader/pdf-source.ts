import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import { MAX_PASSAGE_CHARS, type BookSource, type BookSourceHooks } from "./book-source";
import { pdfjs } from "./pdfjs";

// PDF pages as fixed-size placeholders; only pages within a screen or so of
// the viewport hold a canvas and a text layer, and pages that scroll away give
// theirs back. Parsing runs in pdf.js's worker. SPECs/book-reader-spec.md.

const PAGE_GAP = 16;
const SIDE_PADDING = 24;
const MAX_PAGE_WIDTH = 960;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

interface PageSlot {
  el: HTMLDivElement;
  /** Size at scale 1, from the page itself once rendered (the first page's
   *  until then: most books have one page size). */
  base: { width: number; height: number };
  rendered: HTMLDivElement | null;
  task: RenderTask | null;
  textLayer: pdfjs.TextLayer | null;
  /** Bumped on every render/teardown, so a stale async render bails. */
  generation: number;
  ready: Deferred;
}

export async function openPdf(
  data: ArrayBuffer,
  scroller: HTMLElement,
  host: HTMLElement,
  hooks: BookSourceHooks,
): Promise<BookSource> {
  const doc: PDFDocumentProxy = await pdfjs.getDocument({ data }).promise;
  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  const slots: PageSlot[] = [];
  let scale = 1;

  const fitScale = () =>
    Math.min(MAX_PAGE_WIDTH, Math.max(200, scroller.clientWidth - SIDE_PADDING * 2)) / first.width;

  const sizeSlot = (slot: PageSlot) => {
    slot.el.style.width = `${Math.floor(slot.base.width * scale)}px`;
    slot.el.style.height = `${Math.floor(slot.base.height * scale)}px`;
  };

  scale = fitScale();
  host.style.setProperty("--book-page-gap", `${PAGE_GAP}px`);
  for (let i = 1; i <= doc.numPages; i++) {
    const el = document.createElement("div");
    el.className = "book-pdf-page";
    el.dataset.section = String(i);
    const slot: PageSlot = {
      el,
      base: { width: first.width, height: first.height },
      rendered: null,
      task: null,
      textLayer: null,
      generation: 0,
      ready: deferred(),
    };
    sizeSlot(slot);
    slots.push(slot);
    host.append(el);
  }

  const teardown = (slot: PageSlot) => {
    slot.generation++;
    slot.task?.cancel();
    slot.textLayer?.cancel();
    slot.task = null;
    slot.textLayer = null;
    slot.rendered?.remove();
    slot.rendered = null;
    slot.ready = deferred();
  };

  const render = async (index: number) => {
    const slot = slots[index - 1];
    if (!slot || slot.rendered || slot.task) return;
    const generation = ++slot.generation;
    const page = await doc.getPage(index);
    if (generation !== slot.generation) return;
    const viewport = page.getViewport({ scale });
    slot.base = { width: viewport.width / scale, height: viewport.height / scale };
    sizeSlot(slot);

    const layer = document.createElement("div");
    layer.className = "book-pdf-layer";
    layer.style.setProperty("--scale-factor", String(scale));
    layer.style.setProperty("--total-scale-factor", String(scale));
    const canvas = document.createElement("canvas");
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const text = document.createElement("div");
    text.className = "textLayer";
    layer.append(canvas, text);
    slot.el.append(layer);
    slot.rendered = layer;

    slot.task = page.render({
      canvas,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    });
    slot.textLayer = new pdfjs.TextLayer({
      textContentSource: page.streamTextContent(),
      container: text,
      viewport,
    });
    try {
      await Promise.all([slot.task.promise, slot.textLayer.render()]);
    } catch (error) {
      if (error instanceof pdfjs.RenderingCancelledException) return;
      if (generation !== slot.generation) return;
      console.error(`[book] Couldn't render page ${index}:`, error);
      return;
    } finally {
      if (generation === slot.generation) slot.task = null;
    }
    if (generation !== slot.generation) return;
    slot.ready.resolve();
    hooks.onSectionShown(index);
  };

  // Render a screen and a half either side of the viewport; give back pages
  // that leave that band.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.section);
        const slot = slots[index - 1];
        if (!slot) continue;
        if (entry.isIntersecting) void render(index);
        else if (slot.rendered || slot.task) teardown(slot);
      }
    },
    { root: scroller, rootMargin: "150% 0px" },
  );
  for (const slot of slots) observer.observe(slot.el);

  // A wider or narrower column re-fits the pages, keeping the reading place.
  let lastWidth = scroller.clientWidth;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const resizeObserver = new ResizeObserver(() => {
    if (Math.abs(scroller.clientWidth - lastWidth) < 2) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      lastWidth = scroller.clientWidth;
      const index = currentSection();
      const slot = slots[index - 1]!;
      const within = (scroller.scrollTop - slot.el.offsetTop) / slot.el.offsetHeight;
      scale = fitScale();
      for (const s of slots) {
        const wasRendered = !!(s.rendered || s.task);
        teardown(s);
        sizeSlot(s);
        if (wasRendered) void render(Number(s.el.dataset.section));
      }
      scroller.scrollTop = slot.el.offsetTop + within * slot.el.offsetHeight;
    }, 120);
  });
  resizeObserver.observe(scroller);

  const currentSection = () => {
    const middle = scroller.scrollTop + scroller.clientHeight / 2;
    let lo = 0;
    let hi = slots.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (slots[mid]!.el.offsetTop <= middle) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const pageText = async (index: number) => {
    const root = slots[index - 1]?.rendered?.querySelector(".textLayer");
    if (root) return root.textContent ?? "";
    const content = await (await doc.getPage(index)).getTextContent();
    return content.items.map((item) => ("str" in item ? item.str : "")).join("");
  };

  return {
    unit: "p",
    textRoot: (section) =>
      slots[section - 1]?.rendered && !slots[section - 1]!.task
        ? (slots[section - 1]!.rendered!.querySelector<HTMLElement>(".textLayer") ?? null)
        : null,
    sectionElement: (section) => slots[section - 1]?.el ?? null,
    sectionOf: (node) => {
      const el = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
        ".book-pdf-page",
      );
      return el && host.contains(el) ? Number(el.dataset.section) : null;
    },
    scrollToSection: async (section) => {
      const slot = slots[section - 1];
      if (!slot) return;
      scroller.scrollTop = slot.el.offsetTop - PAGE_GAP;
      void render(section);
      await slot.ready.promise;
    },
    currentSection,
    // Pages are placeholders at their size from the start.
    layOutInView: () => false,
    passage: async () => {
      const index = currentSection();
      const text = await pageText(index);
      return {
        where: `page ${index} of ${doc.numPages}`,
        text: text.slice(0, MAX_PASSAGE_CHARS),
      };
    },
    destroy: () => {
      observer.disconnect();
      resizeObserver.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      for (const slot of slots) teardown(slot);
      void doc.loadingTask.destroy();
    },
  };
}
