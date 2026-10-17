import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { EditorView } from "@codemirror/view";
import { useActiveTabId, useOpenTabs, useResolvedDocumentTitle, type Tab } from "@/hooks/use-tabs";
import { useEditorStore } from "@/stores/editor-store";
import { pageKind } from "./page-kinds";
import { pageKindView } from "./page-kinds/views";
import { showTabMenu } from "./tab-menu";
import { bookPair } from "./book-pair";
import { useBookPages } from "@/lib/book-readers";
import { bookFileOf } from "@/lib/book-highlights";
import { TabTitleRename } from "./tab-title-rename";
import "./tab-columns.css";

// Pointer travel before a header press becomes a drag, so a click that
// wobbles a pixel still only focuses the column.
const DRAG_THRESHOLD_PX = 4;
// Distance from the strip's edge where a drag starts scrolling it, and the
// fastest it scrolls (px per frame) with the pointer at the very edge.
const AUTOSCROLL_EDGE_PX = 64;
const AUTOSCROLL_MAX_STEP_PX = 18;
// Pinch travel (summed wheel deltaY) before a pinch switches between one
// tab and all columns: two or three steps of a trackpad pinch, so the switch
// lands as the fingers start to move. The quiet gap that ends a gesture.
const PINCH_THRESHOLD = 10;
const PINCH_END_MS = 250;

/** Zooming into a book page whose book is not open opens it beside the page,
 *  so the pinch lands on the pair (SPECs/book-reader-spec.md). */
function openBookOfFocusedPage() {
  const { tabs, activeTabId, openFiles } = useEditorStore.getState();
  const active = tabs.find((tab) => tab.id === activeTabId);
  if (active?.location.kind !== "file") return;
  const path = active.location.path;
  if (!bookFileOf(openFiles.get(path)?.frontmatter ?? null)) return;
  const pages = useBookPages.getState().pages;
  const open = tabs.some(
    (tab) =>
      tab.location.kind === "book" && (pages[tab.location.path] ?? tab.location.note) === path,
  );
  if (open) return;
  void import("@/lib/book-import").then(({ openBookOfPage }) => openBookOfPage(path));
}

/** Runs an editor's measure cycle now rather than on its next frame. A
 *  width change reaches CodeMirror through a ResizeObserver it debounces by
 *  50ms, so what it places from measurements (heading labels, grips, list
 *  rails) would sit at the old layout's spots for a few frames, then jump.
 *  `measure` is internal but stable: CodeMirror calls it itself on scroll. */
function measureEditorsNow(strip: HTMLElement) {
  const view = strip.getBoundingClientRect();
  for (const column of strip.querySelectorAll<HTMLElement>(
    ":scope > .tab-column:not([data-hidden])",
  )) {
    const box = column.getBoundingClientRect();
    if (box.right <= view.left || box.left >= view.right) continue;
    for (const dom of column.querySelectorAll<HTMLElement>(".cm-editor")) {
      (EditorView.findFromDOM(dom) as unknown as { measure?: () => void } | null)?.measure?.();
    }
  }
}

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
  // Pinching out (zoom in) on a column shows only that tab, pinching
  // in (zoom out) shows every tab side by side again.
  const [focusedOne, setFocusedOne] = useState(false);
  const focusedOneRef = useRef(focusedOne);
  focusedOneRef.current = focusedOne;
  const canColumn = tabs.length > 1;
  const isColumns = canColumn && !focusedOne;
  // Zoomed into a book or its page: the two show together, as one block.
  const bookPages = useBookPages((s) => s.pages);
  const pair = !isColumns && canColumn ? bookPair(tabs, activeTabId, bookPages) : null;
  const shownAlone = new Set(pair ?? (activeTabId ? [activeTabId] : []));
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

  // One tab ↔ all columns changes every shown editor's width: measure them
  // before this frame paints.
  const layoutKey = `${isColumns} ${pair?.join(" ") ?? ""}`;
  const lastLayoutKeyRef = useRef(layoutKey);
  useLayoutEffect(() => {
    if (lastLayoutKeyRef.current === layoutKey || !stripRef.current) return;
    lastLayoutKeyRef.current = layoutKey;
    measureEditorsNow(stripRef.current);
  }, [layoutKey]);

  // Finish a drop once the store has reordered the tabs: everything snaps to
  // its new slot, and the dropped column eases the leftover distance home.
  const orderKey = tabs.map((t) => t.id).join(" ");
  useLayoutEffect(() => {
    const pending = pendingSettleRef.current;
    if (!pending || !stripRef.current) return;
    pendingSettleRef.current = null;
    settleDrop(stripRef.current, pending.tabId, pending.residual);
  }, [orderKey]);

  // Trackpad pinch reaches the WebView as a wheel event with ctrlKey set.
  // Canvases (boards, Mermaid) zoom on pinch and preventDefault it first.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !canColumn) return;
    // Travel counts from the layout showing: pinching further the way it
    // already went does nothing, and pinching back within the same gesture
    // switches back.
    let travel = 0;
    let quiet = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      event.preventDefault();
      window.clearTimeout(quiet);
      quiet = window.setTimeout(() => {
        travel = 0;
      }, PINCH_END_MS);
      travel += event.deltaY;
      // Out (negative) shows one tab; in (positive) shows the columns.
      travel = focusedOneRef.current ? Math.max(0, travel) : Math.min(0, travel);
      if (Math.abs(travel) < PINCH_THRESHOLD) return;
      travel = 0;
      const focus = !focusedOneRef.current;
      // Zoom into the column under the pointer, not necessarily the active one.
      const hovered = (event.target as Element).closest<HTMLElement>("[data-column-tab]");
      const hoveredTab = hovered?.dataset.columnTab;
      if (focus && hoveredTab && hoveredTab !== useEditorStore.getState().activeTabId) {
        useEditorStore.getState().setActiveTab(hoveredTab);
      }
      if (focus) openBookOfFocusedPage();
      // Committed inside the event, so the new layout is in the next frame.
      flushSync(() => setFocusedOne(focus));
    };
    // preventDefault stops the pinch from also zooming the page.
    // eslint-disable-next-line react-doctor/client-passive-event-listeners
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      strip.removeEventListener("wheel", onWheel);
      window.clearTimeout(quiet);
    };
  }, [canColumn]);

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
    <div
      ref={stripRef}
      className="tab-columns"
      data-columns={isColumns || undefined}
      data-pair={pair !== null || undefined}
    >
      {domOrder.map((tab) => {
        const index = tabs.indexOf(tab);
        const isActive = tab.id === activeTabId;
        const isShown = isColumns || shownAlone.has(tab.id);
        // Without columns only the active tab (or its book pair) shows; kinds
        // that do not keep their state alive while hidden are not mounted.
        if (!isShown && !pageKind(tab.location).keepAlive) return null;
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
            data-hidden={!isShown || undefined}
            data-pair-end={(pair && pair[1] === tab.id) || undefined}
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
              <Component
                location={tab.location}
                isActive={isActive}
                inColumn={isColumns || (pair !== null && isShown)}
              />
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
  const filePath = kind.primaryPath(tab.location);
  const [renaming, setRenaming] = useState(false);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    useEditorStore.getState().moveTab(tab.id, index + delta);
  };

  return (
    <div
      className="tab-column-header"
      onPointerDown={(event) => onDragStart(event, tab.id)}
      onContextMenu={(event) => {
        if (showTabMenu(tab, () => setRenaming(true))) event.preventDefault();
      }}
    >
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
      {renaming && filePath ? (
        <TabTitleRename
          path={filePath}
          className="tab-column-title tab-title-rename"
          onDone={() => setRenaming(false)}
        />
      ) : (
        <span className="tab-column-title">{title}</span>
      )}
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
