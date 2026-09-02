import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useDocumentHeadings, type DocumentHeading } from "@/hooks/use-document-headings";
import { ScrollFade } from "@/components/scroll-fade";
import { SurfaceCard } from "@/components/surface-card";
import { useActiveHeadings } from "./use-active-headings";
import { useEscKey } from "./use-esc-key";
import { useMountTransition } from "./use-mount-transition";
import { showNativeContextMenu } from "./editor-context-menu";
import { EDITOR_SAFE_SCROLL_MARGIN, EDITOR_SCROLLBAR_GUTTER } from "./editor-scroll-container";
import {
  TICK_INACTIVE_SCALE,
  TICK_MAX_WIDTH,
  indentForDepth,
  nextWindowStart,
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
}

function scrollToHeading(view: EditorView, scroller: HTMLElement, heading: DocumentHeading) {
  const pos = Math.min(heading.pos, view.state.doc.length);
  const block = view.lineBlockAt(pos);
  const screenY = view.documentTop + block.top;
  const scrollerRect = scroller.getBoundingClientRect();
  const delta = screenY - scrollerRect.top - EDITOR_SAFE_SCROLL_MARGIN;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const next = Math.max(0, Math.min(scroller.scrollTop + delta, max));
  scroller.scrollTo({ top: next, behavior: "auto" });
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

export function SectionRail({ filePath, view, scrollContainerRef }: SectionRailProps) {
  const headings = useDocumentHeadings(filePath);
  const { activeIndex } = useActiveHeadings(view, scrollContainerRef, headings);
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
    scrollToHeading(view, scroller, heading);
  };

  if (headings.length === 0) return null;

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
                        fontSize: 13,
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
