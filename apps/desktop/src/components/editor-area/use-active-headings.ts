import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { DocumentHeading } from "@/hooks/use-document-headings";

// The reading line: a heading is the one being read once it has scrolled
// above the middle of the pane, by when its section fills most of what's in
// view.
const READING_LINE = 0.5;
// Slack for a scroll that settles a fraction of a pixel short of the end.
const AT_END_SLACK_PX = 2;
// What the writer does to move through the note by hand. Any of them ends a
// heading picked from the rail (see `pin`).
const HAND_EVENTS = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

export interface ActiveHeadings {
  activeIndex: number | null;
  /** Mark a heading the writer jumped to, whatever the reading line says
   *  (a short section lands with the next heading above the line too), until
   *  they next scroll, type or click. */
  pin: (index: number) => void;
}

/** The reading line's screen y. Headings near the end of a note can never
 *  scroll up to it, so once the note is scrolled to its end the line drops to
 *  the pane's bottom: the last heading in view is the one being read. A note
 *  too short to scroll keeps the reading line. */
export function readingLineY(scroller: HTMLElement): number {
  const scrollerRect = scroller.getBoundingClientRect();
  const scrollable = scroller.scrollHeight > scroller.clientHeight;
  const atEnd =
    scrollable &&
    scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - AT_END_SLACK_PX;
  return atEnd ? scrollerRect.bottom : scrollerRect.top + scroller.clientHeight * READING_LINE;
}

function computeActiveIndex(
  view: EditorView,
  scroller: HTMLElement,
  headings: DocumentHeading[],
): number | null {
  if (headings.length === 0) return null;
  const docLen = view.state.doc.length;
  const threshold = readingLineY(scroller);

  let activeIndex: number | null = null;
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const pos = Math.min(h.pos, docLen);
    const block = view.lineBlockAt(pos);
    const screenY = view.documentTop + block.top;
    if (screenY > threshold) break;
    activeIndex = i;
  }
  // Before any heading has scrolled past the threshold we're still on the
  // first heading conceptually — fall back so the rail's first tick lights
  // up at the top of the document.
  return activeIndex ?? 0;
}

export function useActiveHeadings(
  view: EditorView | null,
  scrollContainerRef: React.RefObject<HTMLElement | null>,
  headings: DocumentHeading[],
): ActiveHeadings {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const pinnedRef = useRef<number | null>(null);

  const pin = useCallback((index: number) => {
    pinnedRef.current = index;
    setActiveIndex(index);
  }, []);

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!view || !scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setActiveIndex(pinnedRef.current ?? computeActiveIndex(view, scroller, headings));
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    const unpin = () => {
      if (pinnedRef.current === null) return;
      pinnedRef.current = null;
      schedule();
    };
    pinnedRef.current = null;
    update();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    for (const type of HAND_EVENTS) {
      window.addEventListener(type, unpin, { capture: true, passive: true });
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      for (const type of HAND_EVENTS) {
        window.removeEventListener(type, unpin, { capture: true });
      }
    };
  }, [view, scrollContainerRef, headings]);

  // Without a live editor there is no active heading. Resolve this during
  // render instead of via an effect so the rail never paints a stale tick
  // from a previous file while the reset effect is pending.
  return { activeIndex: view ? activeIndex : null, pin };
}
