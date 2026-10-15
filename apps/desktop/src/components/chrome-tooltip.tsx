import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";

const DELAY_MS = 400;
/** After a tooltip closes, the next one within this window opens at once. */
const SKIP_MS = 300;
const GAP = 6;
const EDGE = 8;

let lastClosedAt = 0;

/**
 * A tooltip under a window-chrome button. The webview never shows a native
 * `title`, so the chrome draws its own. Plain DOM, no Arc: the chrome mounts at
 * startup and Arc stays behind a dynamic import (docs/arc.md). Spread
 * `triggerProps` on the button and render `tooltip` beside it.
 */
export function useChromeTooltip(text: string) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [left, setLeft] = useState(0);

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    const open = () => {
      if (triggerRef.current) setAnchor(triggerRef.current.getBoundingClientRect());
    };
    if (performance.now() - lastClosedAt < SKIP_MS) open();
    else timer.current = window.setTimeout(open, DELAY_MS);
  }, []);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setAnchor((current) => {
      if (current) lastClosedAt = performance.now();
      return null;
    });
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Centre under the trigger, then clamp inside the window once the width is known.
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const width = bubble.offsetWidth;
    const centred = anchor.left + anchor.width / 2 - width / 2;
    setLeft(Math.min(Math.max(EDGE, centred), window.innerWidth - width - EDGE));
  }, [anchor, text]);

  const triggerProps = {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
    },
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType === "mouse") show();
    },
    onPointerLeave: hide,
    onPointerDown: hide,
    onFocus: (event: FocusEvent) => {
      if (event.currentTarget.matches(":focus-visible")) show();
    },
    onBlur: hide,
  };

  const tooltip = anchor
    ? createPortal(
        <div
          ref={bubbleRef}
          aria-hidden
          data-chrome-tooltip
          style={{ top: anchor.bottom + GAP, left }}
          className="pointer-events-none fixed z-[1000] whitespace-nowrap rounded-[var(--radius-chip)] bg-[var(--color-bg-inverse)] px-2 py-1 text-caption text-[var(--color-text-inverse)] shadow-[var(--shadow-popover)]"
        >
          {text}
        </div>,
        document.body,
      )
    : null;

  return { triggerProps, tooltip };
}
