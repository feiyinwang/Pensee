import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useDocumentHeadings, type DocumentHeading } from "@/hooks/use-document-headings";
import { ScrollFade } from "@/components/scroll-fade";
import { SurfaceCard } from "@/components/surface-card";
import { readingLineY, useActiveHeadings } from "./use-active-headings";
import { useEscKey } from "./use-esc-key";
import { useMountTransition } from "./use-mount-transition";
import { showNativeContextMenu } from "./editor-context-menu";
import { EDITOR_SCROLLBAR_GUTTER } from "./editor-scroll-container";
import { scrollPosToSafeTop } from "./editor-scroll";
import { dotOffset, indentForDepth, nextWindowStart, segmentLayout } from "./section-rail-depth";
import "./section-rail.css";

// The hover zone is wider than the 2px line so it can be found; the line runs
// down its middle.
const RAIL_ZONE_WIDTH = 20;
const RAIL_EDGE_INSET = 4;
const RAIL_BOTTOM_INSET = 48;
const RAIL_BAND_GAP = 24;
const POPOVER_WIDTH = 260;
const POPOVER_PAD_Y = 8;
const ROW_HEIGHT = 24;
// The first row's text centre sits level with the top of the line.
const POPOVER_OFFSET = -(POPOVER_PAD_Y + ROW_HEIGHT / 2);
// Passing over the line on the way to the scrollbar must not flash the list.
const OPEN_DELAY_MS = 100;
// Matches --motion-base in section-rail.css / App.css.
const POPOVER_TRANSITION_MS = 160;

interface SectionRailProps {
  filePath: string;
  view: EditorView | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** Where the page header starts, so the line starts level with it. */
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

// A video note's band (video-player.tsx) is sticky over the note's top, with
// the transcript beside the video. The line starts under it, so it never
// covers the video or takes the transcript's wheel; as the band scrolls up to
// stick, the line rides up with it. Written to the node's style, not state: it
// follows every scroll frame.
function useRailTop(
  railRef: RefObject<HTMLElement | null>,
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  top: number,
  mounted: boolean,
) {
  useLayoutEffect(() => {
    const rail = railRef.current;
    const scroller = scrollContainerRef.current;
    const pane = rail?.offsetParent;
    if (!rail || !scroller || !pane) return;
    let band: Element | null = null;
    let applied = -1;
    const place = () => {
      const bandBottom = band
        ? band.getBoundingClientRect().bottom - pane.getBoundingClientRect().top + RAIL_BAND_GAP
        : 0;
      const next = Math.round(Math.max(top, bandBottom));
      if (next === applied) return;
      applied = next;
      rail.style.top = `${next}px`;
      rail.style.height = `calc(100% - ${next + RAIL_BOTTOM_INSET}px)`;
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
  }, [railRef, scrollContainerRef, top, mounted]);
}

// The line's length on screen. It changes only when the pane's height does
// (a window resize, a video band), never on a pinch or a re-wrap, so a pinch
// across twenty tabs redraws no line. A pane hidden behind another tab keeps
// its last length instead of measuring 0.
function useTrackLength(railRef: RefObject<HTMLElement | null>, mounted: boolean): number {
  const [track, setTrack] = useState(0);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = () => {
      const next = rail.clientHeight;
      if (next > 0) setTrack(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    measure();
    return () => observer.disconnect();
  }, [railRef, mounted]);
  return track;
}

// A section's length is its characters, from its heading to the next. Unlike
// rendered pixels, that does not move when the text re-wraps, so the line
// never has to be re-measured while you type or pinch. A board or image counts
// for its markdown, not its height.
function sectionSizes(headings: DocumentHeading[], docLength: number): number[] {
  return headings.map((heading, i) => (headings[i + 1]?.pos ?? docLength) - heading.pos);
}

export function SectionRail({ filePath, view, scrollContainerRef, outlineTop }: SectionRailProps) {
  const headings = useDocumentHeadings(filePath);
  const { activeIndex, pin } = useActiveHeadings(view, scrollContainerRef, headings);
  const [isOpen, setIsOpen] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const { shouldRender, phase } = useMountTransition(isOpen, POPOVER_TRANSITION_MS);
  useEscKey(isOpen, () => setIsOpen(false));

  const railRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const openTimerRef = useRef(0);

  const mounted = headings.length > 0;
  const track = useTrackLength(railRef, mounted);
  useRailTop(railRef, scrollContainerRef, outlineTop, mounted);

  // Headings are parsed from the file's text, so the last section runs to that
  // text's end: the last heading's line plus whatever follows it.
  const docLength = view ? view.state.doc.length : 0;
  const sizes = sectionSizes(
    headings,
    Math.max(docLength, headings[headings.length - 1]?.pos ?? 0),
  );
  const segments = view ? segmentLayout(sizes, track) : [];

  const maxDepth = headings.reduce((max, heading) => Math.max(max, heading.depth), 0);
  const activeDepth = activeIndex === null ? null : (headings[activeIndex]?.depth ?? null);
  const [windowStart, setWindowStart] = useState(0);
  // Indentation only transitions once a frame has been painted at the current
  // window. Without this, opening the list (or switching files) replays the
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

  // The dot is where you are reading: it follows every scroll frame, so it is
  // written to the node's style, not state.
  const segmentTop = activeIndex === null ? undefined : segments[activeIndex]?.top;
  const segmentHeight = activeIndex === null ? undefined : segments[activeIndex]?.height;
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    const dot = dotRef.current;
    if (!view || !scroller || !dot || activeIndex === null) return;
    if (segmentTop === undefined || segmentHeight === undefined) return;
    const segment = { top: segmentTop, height: segmentHeight };
    const start = headings[activeIndex].pos;
    const stop = headings[activeIndex + 1]?.pos;
    let frame = 0;
    // Inside the marked section the dot follows rendered pixels, read from
    // CodeMirror's height map, so it moves evenly past images and boards.
    const place = () => {
      frame = 0;
      const docLen = view.state.doc.length;
      const top = view.lineBlockAt(Math.min(start, docLen)).top;
      const bottom =
        stop === undefined
          ? view.lineBlockAt(docLen).bottom
          : view.lineBlockAt(Math.min(stop, docLen)).top;
      const readingY = readingLineY(scroller) - view.documentTop;
      dot.style.transform = `translateY(${dotOffset(segment, top, bottom, readingY)}px)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    // Placed on the next frame, not inside the render that moved it.
    schedule();
    scroller.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
    };
  }, [view, scrollContainerRef, headings, activeIndex, segmentTop, segmentHeight]);

  // A list taller than the pane opens with the marked row in view. Set by
  // hand, not scrollIntoView, which would also scroll the tab strip to a
  // column that is off to the side.
  // Rows stack at a fixed height, so the marked row's place is its index.
  const activeRowTop = activeIndex === null ? undefined : activeIndex * ROW_HEIGHT;
  useLayoutEffect(() => {
    const list = listScrollRef.current;
    if (!list || activeRowTop === undefined) return;
    if (activeRowTop < list.scrollTop) list.scrollTop = activeRowTop;
    else if (activeRowTop + ROW_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = activeRowTop + ROW_HEIGHT - list.clientHeight;
    }
  }, [activeRowTop, shouldRender]);

  useEffect(() => () => window.clearTimeout(openTimerRef.current), []);

  const openSoon = () => {
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = window.setTimeout(() => setIsOpen(true), OPEN_DELAY_MS);
  };

  const close = () => {
    window.clearTimeout(openTimerRef.current);
    setIsOpen(false);
    setHoverIndex(null);
  };

  // The line stands in the margin people scroll from, so a wheel over it
  // scrolls the note. The open list keeps its own wheel: it can be taller
  // than the pane.
  const handleWheel = (event: React.WheelEvent) => {
    if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    scrollContainerRef.current?.scrollBy({
      top: event.deltaY * scale,
      left: event.deltaX * scale,
    });
  };

  const handlePick = (heading: DocumentHeading) => {
    const scroller = scrollContainerRef.current;
    if (!view || !scroller) return;
    scrollPosToSafeTop(view, scroller, heading.pos, "auto");
    pin(headings.indexOf(heading));
    close();
  };

  if (headings.length === 0) return null;

  return (
    <nav
      ref={railRef}
      className="section-rail absolute z-20"
      aria-label="On this page"
      style={{
        right: `calc(${EDITOR_SCROLLBAR_GUTTER} + ${RAIL_EDGE_INSET}px)`,
        width: RAIL_ZONE_WIDTH,
      }}
      onMouseEnter={openSoon}
      onMouseLeave={close}
      onWheel={handleWheel}
    >
      {segments.map((segment, i) => {
        const heading = headings[i];
        return (
          <button
            key={`${heading.line}-${i}`}
            type="button"
            className="section-rail-segment"
            data-active={i === activeIndex ? "true" : undefined}
            data-hover={i === hoverIndex ? "true" : undefined}
            aria-current={i === activeIndex ? "location" : undefined}
            aria-label={heading.text}
            style={{ top: segment.top, height: segment.height }}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setHoverIndex(i)}
            onClick={() => handlePick(heading)}
            onContextMenu={(event) => handleContextMenu(event, heading)}
          />
        );
      })}
      {segments.length > 0 && <span ref={dotRef} aria-hidden="true" className="section-rail-dot" />}

      {shouldRender && (
        <SurfaceCard
          ref={popoverRef}
          className="section-rail-popover absolute flex flex-col overflow-hidden"
          data-state={phase}
          style={{
            top: POPOVER_OFFSET,
            right: RAIL_ZONE_WIDTH,
            width: POPOVER_WIDTH,
            maxHeight: `calc(100% + ${POPOVER_PAD_Y * 2}px)`,
          }}
        >
          <ScrollFade
            ref={listScrollRef}
            axis="vertical"
            fadeSize="20px"
            className="scrollbar-none min-h-0 overflow-y-auto"
            style={{ padding: `${POPOVER_PAD_Y}px 0` }}
          >
            <ul>
              {headings.map((heading, i) => (
                <li key={`${heading.line}-${i}`}>
                  <button
                    type="button"
                    className={`section-rail-row${i === activeIndex ? " is-active" : ""}${
                      i === hoverIndex ? " is-hover" : ""
                    }`}
                    data-animate={animateIndent ? "true" : "false"}
                    title={heading.text}
                    style={{
                      height: ROW_HEIGHT,
                      paddingLeft: 16 + indentForDepth(heading.depth, windowStart),
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHoverIndex(i)}
                    onClick={() => handlePick(heading)}
                    onContextMenu={(event) => handleContextMenu(event, heading)}
                  >
                    {heading.text}
                  </button>
                </li>
              ))}
            </ul>
          </ScrollFade>
        </SurfaceCard>
      )}
    </nav>
  );
}
