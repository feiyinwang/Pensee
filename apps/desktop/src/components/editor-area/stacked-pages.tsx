import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { EditorPane } from "./editor-pane";
import { stackOf, type FileLocation } from "./page-kinds/file";
import { assignPageSlots, type PageSlot } from "@/lib/stacked-page-slots";
import { getFileName } from "@/lib/paths";
import { useResolvedDocumentTitle } from "@/hooks/use-tabs";
import { useEditorStore } from "@/stores/editor-store";
import "./stacked-pages.css";

// Pointer travel before a header press becomes a drag, so a click that
// wobbles a pixel still only focuses the page.
const DRAG_THRESHOLD_PX = 4;
// Distance from the strip's edge where a drag starts scrolling it, and the
// fastest it scrolls (px per frame) with the pointer at the very edge.
const AUTOSCROLL_EDGE_PX = 64;
const AUTOSCROLL_MAX_STEP_PX = 18;

let slotSequence = 0;
function createSlotId() {
  slotSequence += 1;
  return `page-slot-${slotSequence}`;
}

interface SlotState {
  key: string;
  focus: string;
  slots: PageSlot[];
}

/** Derive slots from the page list during render (no effect round-trip), so
 *  the editor for a swapped page is reused in the same commit. */
function usePageSlots(pages: string[], focus: string): PageSlot[] {
  const key = pages.join("\n");
  const [state, setState] = useState<SlotState>(() => ({
    key,
    focus,
    slots: assignPageSlots([], null, pages, focus, createSlotId),
  }));
  if (state.key === key && state.focus === focus) return state.slots;
  const slots =
    state.key === key
      ? state.slots
      : assignPageSlots(state.slots, state.focus, pages, focus, createSlotId);
  setState({ key, focus, slots });
  return slots;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface StackedPagesProps {
  location: FileLocation;
  isActive: boolean;
}

export const StackedPages = memo(function StackedPages({ location, isActive }: StackedPagesProps) {
  const pages = stackOf(location);
  const focus = location.path;
  const isStacked = pages.length > 1;
  const slots = usePageSlots(pages, focus);

  const stripRef = useRef<HTMLDivElement | null>(null);
  // Set when the focus change came from a press inside that page: the user
  // is already looking at it, so it must not scroll out from under them.
  const pressedPathRef = useRef<string | null>(null);
  const didInitialScrollRef = useRef(false);
  const pendingSettleRef = useRef<{ path: string; residual: number } | null>(null);

  // Play the enter transition on islands created after the first render:
  // start them at the [data-entering] offset, then let the transition run.
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const wasMounted = mountedRef.current;
    mountedRef.current = true;
    if (!wasMounted || !strip || !isStacked || prefersReducedMotion()) return;
    const entering = slots
      .filter((s) => s.fresh)
      .map((s) => pageElement(strip, s.path))
      .filter((el): el is HTMLElement => el !== null);
    if (entering.length === 0) return;
    for (const el of entering) el.dataset.entering = "";
    void strip.offsetWidth; // Commit the start state before transitioning.
    for (const el of entering) delete el.dataset.entering;
  }, [slots, isStacked]);

  // Bring the focused page fully into view when it changes by any route
  // other than a press inside it (a link opening a page, keyboard, restore).
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const el = strip && pageElement(strip, focus);
    if (!isStacked || !isActive || !strip || !el) return;
    if (pressedPathRef.current === focus) {
      pressedPathRef.current = null;
      return;
    }
    const gutter = parseFloat(getComputedStyle(strip).columnGap) || 0;
    const left = el.offsetLeft - gutter;
    const right = el.offsetLeft + el.offsetWidth + gutter;
    const viewLeft = strip.scrollLeft;
    const viewRight = viewLeft + strip.clientWidth;
    let target: number | null = null;
    if (right > viewRight) target = Math.min(left, right - strip.clientWidth);
    else if (left < viewLeft) target = left;
    if (target === null) return;
    const behavior =
      didInitialScrollRef.current && !prefersReducedMotion() ? "smooth" : ("auto" as const);
    didInitialScrollRef.current = true;
    strip.scrollTo({ left: Math.max(0, target), behavior });
  }, [focus, isStacked, isActive, pages.length]);

  // Finish a drop once the store has reordered the pages: everything snaps
  // to its new slot, and the dropped page eases the leftover distance home.
  const orderKey = pages.join("\n");
  useLayoutEffect(() => {
    const pending = pendingSettleRef.current;
    if (!pending) return;
    pendingSettleRef.current = null;
    if (stripRef.current) settleDrop(stripRef.current, pending.path, pending.residual);
  }, [orderKey]);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, path: string) => {
      const strip = stripRef.current;
      const dragged = strip && pageElement(strip, path);
      if (event.button !== 0 || !strip || !dragged) return;
      if ((event.target as Element).closest(".stacked-page-close")) return;
      event.preventDefault();

      const order = stackOf(location);
      const from = order.indexOf(path);
      if (from === -1) return;

      const step = dragged.offsetWidth + (parseFloat(getComputedStyle(strip).columnGap) || 0);
      const startX = event.clientX;
      const startScroll = strip.scrollLeft;
      let lastX = startX;
      let dragging = false;
      let to = from;
      let offset = 0;
      let frame = 0;

      const layout = () => {
        offset = lastX - startX + (strip.scrollLeft - startScroll);
        to = Math.min(Math.max(Math.round(from + offset / step), 0), order.length - 1);
        dragged.style.transform = `translateX(${offset}px)`;
        order.forEach((p, i) => {
          if (p === path) return;
          const el = pageElement(strip, p);
          if (!el) return;
          let shift = 0;
          if (from < to && i > from && i <= to) shift = -step;
          else if (to < from && i >= to && i < from) shift = step;
          el.style.transform = shift ? `translateX(${shift}px)` : "";
        });
      };

      const autoscroll = () => {
        frame = 0;
        const rect = strip.getBoundingClientRect();
        const intoLeft = rect.left + AUTOSCROLL_EDGE_PX - lastX;
        const intoRight = lastX - (rect.right - AUTOSCROLL_EDGE_PX);
        const depth = Math.max(intoLeft, intoRight);
        if (depth <= 0) return;
        const speed = Math.min(1, depth / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_STEP_PX;
        const before = strip.scrollLeft;
        strip.scrollLeft += intoLeft > 0 ? -speed : speed;
        if (strip.scrollLeft === before) return;
        layout();
        frame = requestAnimationFrame(autoscroll);
      };

      const onMove = (move: PointerEvent) => {
        lastX = move.clientX;
        if (!dragging) {
          if (Math.abs(lastX - startX) < DRAG_THRESHOLD_PX) return;
          dragging = true;
          strip.dataset.dragging = "";
          dragged.dataset.dragging = "";
        }
        layout();
        if (!frame) frame = requestAnimationFrame(autoscroll);
      };

      const finish = (commit: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (frame) cancelAnimationFrame(frame);
        if (!dragging) return;
        const target = commit ? to : from;
        const residual = offset - (target - from) * step;
        if (target === from) {
          settleDrop(strip, path, residual);
          return;
        }
        pendingSettleRef.current = { path, residual };
        useEditorStore.getState().moveStackedPage(path, target);
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [location],
  );

  const onPagePointerDown = useCallback(
    (path: string) => {
      if (!isStacked || path === focus) return;
      pressedPathRef.current = path;
      useEditorStore.getState().focusStackedPage(path);
    },
    [focus, isStacked],
  );

  return (
    <div
      ref={stripRef}
      className={`stacked-pages ${isActive ? "z-10" : "invisible pointer-events-none"}`}
      data-stacked={isStacked || undefined}
      data-active={isActive || undefined}
    >
      {slots.map(({ slot, path }) => {
        const index = pages.indexOf(path);
        const isFocused = path === focus;
        return (
          <section
            key={slot}
            className="stacked-page"
            data-path={path}
            style={{ order: index }}
            data-focused={(isStacked && isFocused) || undefined}
            aria-label={isStacked ? `Page ${index + 1} of ${pages.length}` : undefined}
            onPointerDownCapture={() => onPagePointerDown(path)}
          >
            {isStacked ? (
              <StackedPageHeader
                path={path}
                index={index}
                count={pages.length}
                onDragStart={startDrag}
              />
            ) : null}
            <div className="stacked-page-body">
              <EditorPane path={path} isActive={isActive && isFocused} inStack={isStacked} />
            </div>
          </section>
        );
      })}
    </div>
  );
});

interface StackedPageHeaderProps {
  path: string;
  index: number;
  count: number;
  onDragStart: (event: ReactPointerEvent<HTMLElement>, path: string) => void;
}

function StackedPageHeader({ path, index, count, onDragStart }: StackedPageHeaderProps) {
  const title = useResolvedDocumentTitle(path) || getFileName(path);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    useEditorStore.getState().moveStackedPage(path, index + delta);
  };

  return (
    <div className="stacked-page-header" onPointerDown={(event) => onDragStart(event, path)}>
      <button
        type="button"
        className="stacked-page-grip"
        aria-label={`Move ${title}, position ${index + 1} of ${count}. Use the left and right arrow keys.`}
        title="Drag to move"
        onKeyDown={onKeyDown}
      >
        <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
          {[2, 7, 12].map((y) =>
            [3, 7].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />),
          )}
        </svg>
      </button>
      <span className="stacked-page-title">{title}</span>
      <button
        type="button"
        className="stacked-page-close"
        aria-label={`Close ${title}`}
        title="Close page"
        onClick={() => useEditorStore.getState().closeStackedPage(path)}
      >
        ×
      </button>
    </div>
  );
}

function pageElement(strip: HTMLElement, path: string) {
  return strip.querySelector<HTMLElement>(`:scope > [data-path="${CSS.escape(path)}"]`);
}

/** Land a drop: the displaced pages snap to their slots (they already sit
 *  there visually), and the dropped page eases `residual` px home on the
 *  spring. Runs with the DOM already in its final order. */
function settleDrop(strip: HTMLElement, path: string, residual: number) {
  const pages = [...strip.children] as HTMLElement[];
  for (const el of pages) {
    el.style.transition = "none";
    el.style.transform = el.dataset.path === path ? `translateX(${residual}px)` : "";
  }
  delete strip.dataset.dragging;
  const dragged = pageElement(strip, path);
  if (!dragged) return;
  void dragged.offsetWidth; // Commit the start position before transitioning.
  for (const el of pages) el.style.transition = "";
  dragged.dataset.settling = "";
  dragged.style.transform = "";
  const done = () => {
    delete dragged.dataset.dragging;
    delete dragged.dataset.settling;
  };
  if (residual === 0 || prefersReducedMotion()) done();
  else dragged.addEventListener("transitionend", done, { once: true });
}
