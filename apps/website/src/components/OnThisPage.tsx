import { useEffect, useRef, useState } from "react";

import type { OutlineItem } from "../pages/parse";

/** The sticky bar's height (`.bar`): the visible pane starts under it. */
const BAR = 56;
/** Within this of the bottom, the page counts as scrolled to its end. */
const END_SLACK = 2;
/** Only the reader's own input clears a clicked row, never the jump's scroll. */
const USER_INPUT = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

/**
 * The page's sections beside the text, the one being read marked. A section
 * is marked once its heading passes the middle of the visible pane; at the
 * end of the page, the last heading on screen; after a click, the clicked
 * row until the reader scrolls or types. Wide screens show the list; medium
 * ones a column of ticks that opens the list on hover or focus (styles.css).
 */
export function OnThisPage({ outline }: { outline: OutlineItem[] }) {
  const [active, setActive] = useState(0);
  const pinned = useRef(false);
  const list = useRef<HTMLOListElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    const headings = outline
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      // Folded into ticks, the list sits over the page's edge, so it waits
      // until the article fills the middle of the pane (never over the hero).
      const start = headings[0].closest("main")?.getBoundingClientRect().top ?? 0;
      nav.current?.toggleAttribute("data-away", start > BAR + (innerHeight - BAR) / 2);
      if (pinned.current) return;
      const doc = document.documentElement;
      const scrolls = doc.scrollHeight > innerHeight + END_SLACK;
      const atEnd = scrolls && scrollY + innerHeight >= doc.scrollHeight - END_SLACK;
      const line = atEnd ? innerHeight : BAR + (innerHeight - BAR) / 2;
      let index = 0;
      headings.forEach((heading, i) => {
        if (heading.getBoundingClientRect().top <= line) index = i;
      });
      setActive((current) => (current === index ? current : index));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const unpin = () => {
      pinned.current = false;
      schedule();
    };

    measure();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    for (const type of USER_INPUT) addEventListener(type, unpin, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      for (const type of USER_INPUT) removeEventListener(type, unpin, { capture: true });
    };
  }, [outline]);

  // The marker takes the marked row's real box, after rows wrap. A list taller
  // than its space keeps that row in view by its own scrollTop, never
  // scrollIntoView, which would scroll the page too.
  useEffect(() => {
    const row = list.current?.children[active] as HTMLElement | undefined;
    if (!row || !list.current || !marker.current) return;
    marker.current.style.transform = `translateY(${row.offsetTop}px)`;
    marker.current.style.height = `${row.offsetHeight}px`;
    marker.current.dataset.ready = "";
    const { scrollTop, clientHeight } = list.current;
    if (row.offsetTop < scrollTop) list.current.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > scrollTop + clientHeight) {
      list.current.scrollTop = row.offsetTop + row.offsetHeight - clientHeight;
    }
  }, [active]);

  return (
    <nav className="toc" aria-label="On this page" ref={nav} data-away="">
      <p className="toc-title">On this page</p>
      <div className="toc-body">
        <span className="toc-marker" ref={marker} aria-hidden="true" />
        <ol ref={list}>
          {outline.map((item, i) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={i === active ? "location" : undefined}
                onClick={() => {
                  pinned.current = true;
                  setActive(i);
                }}
              >
                <span className="toc-label">{item.text}</span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
