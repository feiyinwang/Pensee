import {
  useCallback,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useActiveTabId, useOpenTabs, useResolvedDocumentTitle, type Tab } from "@/hooks/use-tabs";
import { useEditorStore } from "@/stores/editor-store";
import { pageKind } from "./page-kinds";
import { pageKindView } from "./page-kinds/views";
import "./tab-columns.css";

// Pointer travel before a header press becomes a drag, so a click that
// wobbles a pixel still only focuses the column.
const DRAG_THRESHOLD_PX = 4;
// Distance from the strip's edge where a drag starts scrolling it, and the
// fastest it scrolls (px per frame) with the pointer at the very edge.
const AUTOSCROLL_EDGE_PX = 64;
const AUTOSCROLL_MAX_STEP_PX = 18;

/** Tab ids are `tab-<sequence>`, increasing as tabs are created. */
function tabSequence(id: string) {
  return Number(id.slice(id.lastIndexOf("-") + 1)) || 0;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function columnElement(strip: HTMLElement, tabId: string) {
  return strip.querySelector<HTMLElement>(`:scope > [data-column-tab="${CSS.escape(tabId)}"]`);
}

/**
 * Every open tab, side by side. One tab fills the panel as it always has;
 * with two or more, each tab is a glass island in a horizontally scrolling
 * strip, ordered like the tab bar, draggable by its header. See
 * SPECs/tab-columns-spec.md.
 *
 * Columns render in creation order and are placed with CSS `order`, so a
 * reorder never moves a DOM node: moving one would reset the scroll position
 * of the page inside it.
 */
export function TabColumns() {
  const tabs = useOpenTabs();
  const activeTabId = useActiveTabId();
  const isColumns = tabs.length > 1;
  const domOrder = [...tabs].sort((a, b) => tabSequence(a.id) - tabSequence(b.id));

  const stripRef = useRef<HTMLDivElement | null>(null);
  // Set when activation came from a press inside that column: the user is
  // already looking at it, so it must not scroll out from under them.
  const pressedTabRef = useRef<string | null>(null);
  const didInitialScrollRef = useRef(false);
  const pendingSettleRef = useRef<{ tabId: string; residual: number } | null>(null);
  const knownTabsRef = useRef<Set<string> | null>(null);

  // Slide in columns for tabs opened after the first render: start them at
  // the [data-entering] offset, then let the transition run. (Not
  // @starting-style: the app's WebKit applies that block as a plain rule.)
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const known = knownTabsRef.current;
    knownTabsRef.current = new Set(tabs.map((t) => t.id));
    if (!known || !strip || !isColumns || prefersReducedMotion()) return;
    const entering = tabs
      .filter((t) => !known.has(t.id))
      .map((t) => columnElement(strip, t.id))
      .filter((el): el is HTMLElement => el !== null);
    if (entering.length === 0) return;
    for (const el of entering) el.dataset.entering = "";
    void strip.offsetWidth; // Commit the start state before transitioning.
    for (const el of entering) delete el.dataset.entering;
  }, [tabs, isColumns]);

  // Bring the active column fully into view when it changes by any route
  // other than a press inside it (tab bar, link, keyboard, restore).
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const el = strip && activeTabId ? columnElement(strip, activeTabId) : null;
    if (!isColumns || !strip || !el) return;
    if (pressedTabRef.current === activeTabId) {
      pressedTabRef.current = null;
      return;
    }
    const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
    const left = el.offsetLeft - gap;
    const right = el.offsetLeft + el.offsetWidth + gap;
    const viewLeft = strip.scrollLeft;
    const viewRight = viewLeft + strip.clientWidth;
    let target: number | null = null;
    if (right > viewRight) target = Math.min(left, right - strip.clientWidth);
    else if (left < viewLeft) target = left;
    if (target === null) return;
    const smooth = didInitialScrollRef.current && !prefersReducedMotion();
    didInitialScrollRef.current = true;
    strip.scrollTo({ left: Math.max(0, target), behavior: smooth ? "smooth" : "auto" });
  }, [activeTabId, isColumns, tabs.length]);

  // Finish a drop once the store has reordered the tabs: everything snaps to
  // its new slot, and the dropped column eases the leftover distance home.
  const orderKey = tabs.map((t) => t.id).join(" ");
  useLayoutEffect(() => {
    const pending = pendingSettleRef.current;
    if (!pending || !stripRef.current) return;
    pendingSettleRef.current = null;
    settleDrop(stripRef.current, pending.tabId, pending.residual);
  }, [orderKey]);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>, tabId: string) => {
    const strip = stripRef.current;
    const dragged = strip && columnElement(strip, tabId);
    if (event.button !== 0 || !strip || !dragged) return;
    if ((event.target as Element).closest(".tab-column-close")) return;
    event.preventDefault();

    const order = useEditorStore.getState().tabs.map((t) => t.id);
    const from = order.indexOf(tabId);
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
      order.forEach((id, i) => {
        if (id === tabId) return;
        const el = columnElement(strip, id);
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
        settleDrop(strip, tabId, residual);
        return;
      }
      pendingSettleRef.current = { tabId, residual };
      useEditorStore.getState().moveTab(tabId, target);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }, []);

  const onColumnPointerDown = useCallback(
    (tabId: string) => {
      if (!isColumns || tabId === activeTabId) return;
      pressedTabRef.current = tabId;
      useEditorStore.getState().setActiveTab(tabId);
    },
    [activeTabId, isColumns],
  );

  return (
    <div ref={stripRef} className="tab-columns" data-columns={isColumns || undefined}>
      {domOrder.map((tab) => {
        const index = tabs.indexOf(tab);
        const isActive = tab.id === activeTabId;
        // Without columns only the active tab shows; kinds that do not keep
        // their state alive while hidden are not mounted at all.
        if (!isColumns && !isActive && !pageKind(tab.location).keepAlive) return null;
        const Component = pageKindView(tab.location).Component as React.ComponentType<{
          location: Tab["location"];
          isActive: boolean;
          inColumn: boolean;
        }>;
        return (
          <section
            key={tab.id}
            className="tab-column"
            style={{ order: index }}
            data-column-tab={tab.id}
            data-focused={(isColumns && isActive) || undefined}
            data-hidden={(!isColumns && !isActive) || undefined}
            aria-label={isColumns ? `Column ${index + 1} of ${tabs.length}` : undefined}
            onPointerDownCapture={() => onColumnPointerDown(tab.id)}
          >
            {isColumns ? (
              <TabColumnHeader
                tab={tab}
                index={index}
                count={tabs.length}
                onDragStart={startDrag}
              />
            ) : null}
            <div className="tab-column-body">
              <Component location={tab.location} isActive={isActive} inColumn={isColumns} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

interface TabColumnHeaderProps {
  tab: Tab;
  index: number;
  count: number;
  onDragStart: (event: ReactPointerEvent<HTMLElement>, tabId: string) => void;
}

function TabColumnHeader({ tab, index, count, onDragStart }: TabColumnHeaderProps) {
  const kind = pageKind(tab.location);
  const documentTitle = useResolvedDocumentTitle(kind.primaryPath(tab.location));
  const title = documentTitle || kind.title(tab.location);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    useEditorStore.getState().moveTab(tab.id, index + delta);
  };

  return (
    <div className="tab-column-header" onPointerDown={(event) => onDragStart(event, tab.id)}>
      <button
        type="button"
        className="tab-column-grip"
        aria-label={`Move ${title}, column ${index + 1} of ${count}. Use the left and right arrow keys.`}
        title="Drag to move"
        onKeyDown={onKeyDown}
      >
        <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
          {[2, 7, 12].map((y) =>
            [3, 7].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />),
          )}
        </svg>
      </button>
      <span className="tab-column-title">{title}</span>
      <button
        type="button"
        className="tab-column-close"
        aria-label={`Close ${title}`}
        title="Close tab"
        onClick={() => useEditorStore.getState().closeTab(tab.id)}
      >
        ×
      </button>
    </div>
  );
}

/** Land a drop: the displaced columns snap to their slots (they already sit
 *  there visually), and the dropped column eases `residual` px home on the
 *  spring. Runs with the layout already in its final order. */
function settleDrop(strip: HTMLElement, tabId: string, residual: number) {
  const columns = [...strip.children] as HTMLElement[];
  for (const el of columns) {
    el.style.transition = "none";
    el.style.transform = el.dataset.columnTab === tabId ? `translateX(${residual}px)` : "";
  }
  delete strip.dataset.dragging;
  const dragged = columnElement(strip, tabId);
  if (!dragged) return;
  void dragged.offsetWidth; // Commit the start position before transitioning.
  for (const el of columns) el.style.transition = "";
  dragged.dataset.settling = "";
  dragged.style.transform = "";
  const done = () => {
    delete dragged.dataset.dragging;
    delete dragged.dataset.settling;
  };
  if (residual === 0 || prefersReducedMotion()) done();
  else dragged.addEventListener("transitionend", done, { once: true });
}
