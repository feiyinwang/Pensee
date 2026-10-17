import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { EditorView } from "@codemirror/view";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useDocumentHeadings, type DocumentHeading } from "@/hooks/use-document-headings";
import { ScrollFade } from "@/components/scroll-fade";
import { SurfaceCard } from "@/components/surface-card";
import { useActiveHeadings } from "./use-active-headings";
import { useEscKey } from "./use-esc-key";
import { useMountTransition } from "./use-mount-transition";
import { showNativeContextMenu } from "./editor-context-menu";
import { EDITOR_SCROLLBAR_GUTTER } from "./editor-scroll-container";
import { scrollPosToSafeTop } from "./editor-scroll";
import {
  TICK_INACTIVE_SCALE,
  TICK_MAX_WIDTH,
  OUTLINE_EDGE_INSET,
  indentForDepth,
  nextWindowStart,
  outlineWidthForRoom,
  tickWidthForDepth,
} from "./section-rail-depth";
import "./section-rail.css";

const TICK_HEIGHT = 1;
const TICK_GAP = 6;
const RAIL_EDGE_INSET = 12;
const RAIL_INNER_WIDTH = TICK_MAX_WIDTH + 2;
const RAIL_ZONE_WIDTH = RAIL_EDGE_INSET + RAIL_INNER_WIDTH;
const POPOVER_WIDTH = 260;
const POPOVER_EDGE_INSET = RAIL_EDGE_INSET;
// Matches --motion-base in section-rail.css / App.css.
const POPOVER_TRANSITION_MS = 160;

interface SectionRailProps {
  filePath: string;
  view: EditorView | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** Where the page header starts, so the standing outline lines up with it. */
  outlineTop: number;
}

function buildHeadingLink(heading: DocumentHeading) {
  return `[${heading.text}](#${heading.slug})`;
}

function handleContextMenu(event: React.MouseEvent, heading: DocumentHeading) {
  event.preventDefault();
  event.stopPropagation();
  void showNativeContextMenu(
    [
      {
        kind: "item",
        id: "copy-heading-link",
        text: "Copy heading link",
        action: () => {
          void writeText(buildHeadingLink(heading));
        },
      },
    ],
    { x: event.clientX, y: event.clientY },
  );
}

// The margin right of the text column decides the rail's form. It is read off
// `.cm-content` itself (its box minus its right padding is the text column), so
// every page-width preset, tab column and window size lands without a table of
// breakpoints. The observer watches the content box too: a preset change moves
// the padding without resizing the scroller.
function useOutlineWidth(
  view: EditorView | null,
  scrollContainerRef: RefObject<HTMLDivElement | null>,
): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!view || !scroller) return;
    const content = view.contentDOM;
    const gutter = parseFloat(EDITOR_SCROLLBAR_GUTTER);
    const measure = () => {
      const contentRect = content.getBoundingClientRect();
      const textRight = contentRect.right - parseFloat(getComputedStyle(content).paddingRight);
      setWidth(outlineWidthForRoom(scroller.getBoundingClientRect().right - gutter - textRight));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(content);
    return () => observer.disconnect();
  }, [view, scrollContainerRef]);
  return view ? width : null;
}

export function SectionRail({ filePath, view, scrollContainerRef, outlineTop }: SectionRailProps) {
  const headings = useDocumentHeadings(filePath);
  const { activeIndex, pin } = useActiveHeadings(view, scrollContainerRef, headings);
  const outlineWidth = useOutlineWidth(view, scrollContainerRef);
  const [isOpen, setIsOpen] = useState(false);
  const { shouldRender, phase } = useMountTransition(isOpen, POPOVER_TRANSITION_MS);
  useEscKey(isOpen, () => setIsOpen(false));

  const railZoneRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const maxDepth = headings.reduce((max, heading) => Math.max(max, heading.depth), 0);
  const activeDepth = activeIndex === null ? null : (headings[activeIndex]?.depth ?? null);
  const [windowStart, setWindowStart] = useState(0);
  // Indentation only transitions once a frame has been painted at the current
  // window. Without this, opening the popover (or switching files) replays the
  // slide as an entrance animation and the titles visibly skate sideways.
  const [animateIndent, setAnimateIndent] = useState(false);

  // A new file's depth structure has nothing to do with the old one, so the
  // window restarts from 0 rather than inheriting — and lands there without a
  // transition, courtesy of the animateIndent effect below.
  const lastFilePathRef = useRef(filePath);
  useEffect(() => {
    const switched = lastFilePathRef.current !== filePath;
    lastFilePathRef.current = filePath;
    setWindowStart((current) => nextWindowStart(switched ? 0 : current, activeDepth, maxDepth));
  }, [filePath, activeDepth, maxDepth]);

  useEffect(() => {
    setAnimateIndent(false);
    if (!shouldRender) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setAnimateIndent(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [shouldRender, filePath]);

  // Move-between rail and popover keeps the popover open; leaving to
  // anywhere else closes. Crucial because the popover overlaps the rail
  // x-range — we still need an explicit relatedTarget check to bridge.
  const handleRailLeave = (event: React.MouseEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && popoverRef.current?.contains(next)) return;
    setIsOpen(false);
  };

  const handlePopoverLeave = (event: React.MouseEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && railZoneRef.current?.contains(next)) return;
    setIsOpen(false);
  };

  const handleTickClick = (heading: DocumentHeading) => {
    const scroller = scrollContainerRef.current;
    if (!view || !scroller) return;
    scrollPosToSafeTop(view, scroller, heading.pos, "auto");
    pin(headings.indexOf(heading));
  };

  if (headings.length === 0) return null;

  if (outlineWidth !== null) {
    return (
      <SectionOutline
        filePath={filePath}
        headings={headings}
        activeIndex={activeIndex}
        windowStart={windowStart}
        width={outlineWidth}
        top={outlineTop}
        scrollContainerRef={scrollContainerRef}
        onPick={handleTickClick}
      />
    );
  }

  const tickStackHeight =
    headings.length * TICK_HEIGHT + Math.max(0, headings.length - 1) * TICK_GAP;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-20"
      style={{
        right: EDITOR_SCROLLBAR_GUTTER,
        width: POPOVER_EDGE_INSET + POPOVER_WIDTH,
      }}
    >
      <div
        ref={railZoneRef}
        className="pointer-events-auto absolute right-0 top-1/2 -translate-y-1/2"
        style={{ width: RAIL_ZONE_WIDTH, height: tickStackHeight }}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={handleRailLeave}
      >
        <ScrollFade
          alwaysFade
          fadeSize="48px"
          className="pointer-events-none absolute left-0 right-0 top-1/2 h-[70vh] -translate-y-1/2 overflow-hidden"
        >
          <nav
            className="section-rail-ticks absolute top-1/2 flex flex-col items-end"
            data-open={isOpen ? "true" : "false"}
            style={{
              right: RAIL_EDGE_INSET,
              width: RAIL_INNER_WIDTH,
              gap: TICK_GAP,
              color: "var(--text-primary, currentColor)",
              pointerEvents: "none",
            }}
            aria-label="Document sections"
          >
            {headings.map((heading, i) => {
              const isActive = i === activeIndex;
              const tickStyle: CSSProperties = {
                width: tickWidthForDepth(heading.depth),
                height: TICK_HEIGHT,
                background: "currentColor",
                opacity: isActive ? 1 : 0.35,
                transform: isActive ? "scaleX(1)" : `scaleX(${TICK_INACTIVE_SCALE})`,
                transition:
                  "transform var(--motion-base) var(--ease-out), opacity var(--motion-base) var(--ease-out), width var(--motion-base) var(--ease-out)",
                pointerEvents: "auto",
              };
              return (
                <button
                  key={`${heading.line}-${i}`}
                  type="button"
                  className="section-rail-tick block cursor-default border-0 bg-transparent p-0"
                  style={tickStyle}
                  title={heading.text}
                  aria-label={heading.text}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleTickClick(heading)}
                  onContextMenu={(event) => handleContextMenu(event, heading)}
                />
              );
            })}
          </nav>
        </ScrollFade>
      </div>

      {shouldRender && (
        <SurfaceCard
          ref={popoverRef}
          className="section-rail-popover pointer-events-auto absolute overflow-hidden"
          data-state={phase}
          style={{
            top: "50%",
            right: POPOVER_EDGE_INSET,
            width: POPOVER_WIDTH,
          }}
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={handlePopoverLeave}
        >
          <ScrollFade
            axis="vertical"
            fadeSize="20px"
            className="scrollbar-none max-h-[70vh] overflow-y-auto px-4 py-3"
          >
            <ul className="flex flex-col" style={{ gap: 4 }}>
              {headings.map((heading, i) => {
                const isActive = i === activeIndex;
                return (
                  <li key={`${heading.line}-${i}`}>
                    <button
                      type="button"
                      className={`section-rail-popover-row block w-full cursor-default truncate border-0 bg-transparent p-0 text-left${
                        isActive ? " is-active" : ""
                      }`}
                      data-animate={animateIndent ? "true" : "false"}
                      title={heading.text}
                      style={{
                        fontSize: "var(--text-label)",
                        letterSpacing: "-0.01em",
                        lineHeight: 1.5,
                        paddingLeft: indentForDepth(heading.depth, windowStart),
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleTickClick(heading)}
                      onContextMenu={(event) => handleContextMenu(event, heading)}
                    >
                      {heading.text}
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollFade>
        </SurfaceCard>
      )}
    </div>
  );
}

interface SectionOutlineProps {
  filePath: string;
  headings: DocumentHeading[];
  activeIndex: number | null;
  windowStart: number;
  width: number;
  top: number;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onPick: (heading: DocumentHeading) => void;
}

const OUTLINE_BOTTOM_INSET = 48;
const OUTLINE_ROW_INSET = 14;
const OUTLINE_LIST_FADE = 20;
const OUTLINE_BAND_GAP = 24;

// A video note's band (video-player.tsx) is sticky over the note's top, with
// the transcript beside the video. The outline starts under it, next to the
// text, so it never covers the video or takes the transcript's wheel; as the
// band scrolls up to stick, the outline rides up with it. Written to the
// node's style, not state: it follows every scroll frame.
function useOutlineTop(
  navRef: RefObject<HTMLElement | null>,
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  top: number,
) {
  useLayoutEffect(() => {
    const nav = navRef.current;
    const scroller = scrollContainerRef.current;
    const pane = nav?.offsetParent;
    if (!nav || !scroller || !pane) return;
    let band: Element | null = null;
    let applied = -1;
    const place = () => {
      const bandBottom = band
        ? band.getBoundingClientRect().bottom - pane.getBoundingClientRect().top + OUTLINE_BAND_GAP
        : 0;
      const next = Math.round(Math.max(top, bandBottom));
      if (next === applied) return;
      applied = next;
      nav.style.top = `${next}px`;
      nav.style.maxHeight = `calc(100% - ${next + OUTLINE_BOTTOM_INSET}px)`;
    };
    const resize = new ResizeObserver(place);
    // The band mounts once its player page answers, and goes with the link.
    const findBand = () => {
      const found = scroller.querySelector(":scope > .video-band");
      if (found === band) return;
      if (band) resize.unobserve(band);
      band = found;
      if (band) resize.observe(band);
      place();
    };
    const children = new MutationObserver(findBand);
    children.observe(scroller, { childList: true });
    resize.observe(scroller);
    scroller.addEventListener("scroll", place, { passive: true });
    findBand();
    place();
    return () => {
      children.disconnect();
      resize.disconnect();
      scroller.removeEventListener("scroll", place);
    };
  }, [navRef, scrollContainerRef, top]);
}

// The rail opened up: every heading readable at rest, the one in view marked on
// a hairline. Rows wrap to two lines rather than truncate — a standing outline
// is read, not skimmed for a target the way the hover popover is.
function SectionOutline({
  filePath,
  headings,
  activeIndex,
  windowStart,
  width,
  top,
  scrollContainerRef,
  onPick,
}: SectionOutlineProps) {
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null);
  // The marker slides between rows only after it has been painted once at the
  // current file, so opening a file or widening the window never replays a
  // slide down from the first row.
  const [animateMarker, setAnimateMarker] = useState(false);

  // Rows wrap, so the marker reads the active row's real box. Width, indent
  // and heading text all change the wrap, hence the deps.
  useLayoutEffect(() => {
    const row =
      activeIndex === null
        ? null
        : listRef.current?.querySelector<HTMLElement>(`[data-outline-index="${activeIndex}"]`);
    setMarker(row ? { top: row.offsetTop, height: row.offsetHeight } : null);
  }, [activeIndex, headings, width, windowStart]);

  // Keep the active row inside the list when the outline is taller than the
  // pane. Set by hand, not scrollIntoView, which would also scroll the tab
  // strip to a column that is off to the side. Instant: scrolling the note is
  // the motion the user is watching.
  useEffect(() => {
    const list = listScrollRef.current;
    if (!list || !marker) return;
    if (marker.top - OUTLINE_LIST_FADE < list.scrollTop) {
      list.scrollTop = marker.top - OUTLINE_LIST_FADE;
    } else if (
      marker.top + marker.height + OUTLINE_LIST_FADE >
      list.scrollTop + list.clientHeight
    ) {
      list.scrollTop = marker.top + marker.height + OUTLINE_LIST_FADE - list.clientHeight;
    }
  }, [marker]);

  // The outline stands where the note's margin is, so a wheel over it scrolls
  // the note, as it would over the empty margin. The list itself never takes
  // the wheel: it follows the note instead.
  const handleWheel = (event: React.WheelEvent) => {
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    scrollContainerRef.current?.scrollBy({
      top: event.deltaY * scale,
      left: event.deltaX * scale,
    });
  };

  useOutlineTop(navRef, scrollContainerRef, top);

  useEffect(() => {
    setAnimateMarker(false);
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setAnimateMarker(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [filePath]);

  return (
    <nav
      ref={navRef}
      className="section-outline absolute z-20 flex flex-col"
      aria-label="On this page"
      style={{
        right: `calc(${EDITOR_SCROLLBAR_GUTTER} + ${OUTLINE_EDGE_INSET}px)`,
        width,
      }}
      onWheel={handleWheel}
    >
      <div className="section-outline-title">On this page</div>
      <ScrollFade
        axis="vertical"
        fadeSize="20px"
        className="scrollbar-none min-h-0 overflow-y-auto"
      >
        <ul ref={listRef} className="section-outline-list">
          {marker && (
            <li
              aria-hidden="true"
              className="section-outline-marker"
              data-animate={animateMarker ? "true" : "false"}
              style={{ transform: `translateY(${marker.top}px) scaleY(${marker.height})` }}
            />
          )}
          {headings.map((heading, i) => (
            <li key={`${heading.line}-${i}`}>
              <button
                type="button"
                data-outline-index={i}
                className={`section-outline-row${i === activeIndex ? " is-active" : ""}`}
                aria-current={i === activeIndex ? "location" : undefined}
                title={heading.text}
                style={{
                  paddingLeft: OUTLINE_ROW_INSET + indentForDepth(heading.depth, windowStart),
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(heading)}
                onContextMenu={(event) => handleContextMenu(event, heading)}
              >
                <span className="section-outline-label">{heading.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollFade>
    </nav>
  );
}
