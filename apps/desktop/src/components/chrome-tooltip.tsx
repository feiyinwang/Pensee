import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import { keyLabel } from "@/lib/platform";

const DELAY_MS = 400;
/** After a tooltip closes, the next one within this window opens at once. */
const SKIP_MS = 300;
const GAP = 6;
const EDGE = 8;

let lastClosedAt = 0;

/**
 * A tooltip for window chrome: under a button, or right of a sidebar row. The
 * webview never shows a native `title`, so the chrome draws its own. Plain DOM,
 * no Arc: the chrome mounts at startup and Arc stays behind a dynamic import
 * (docs/arc.md). `keys` is the shortcut, one keycap each (`["⌘", "P"]`).
 * Spread `triggerProps` on the trigger and render `tooltip` beside it.
 */
export function useChromeTooltip(
  text: string,
  { keys = [], side = "bottom" }: { keys?: readonly string[]; side?: "bottom" | "right" } = {},
) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

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

  // Centre on the trigger's side, then clamp inside the window once the size is known.
  const keysText = keys.join(" ");
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const { offsetWidth: width, offsetHeight: height } = bubble;
    const clamp = (value: number, size: number, room: number) =>
      Math.min(Math.max(EDGE, value), room - size - EDGE);
    setPosition(
      side === "right"
        ? {
            top: clamp(anchor.top + anchor.height / 2 - height / 2, height, window.innerHeight),
            left: anchor.right + GAP,
          }
        : {
            top: anchor.bottom + GAP,
            left: clamp(anchor.left + anchor.width / 2 - width / 2, width, window.innerWidth),
          },
    );
  }, [anchor, text, keysText, side]);

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
          style={position}
          className="pointer-events-none fixed z-[1000] flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-chip)] bg-[var(--color-bg-inverse)] px-2 py-1 text-caption text-[var(--color-text-inverse)] shadow-[var(--shadow-popover)]"
        >
          {text}
          {keys.length > 0 && (
            <span className="flex items-center gap-0.5">
              {keys.map((key) => (
                <kbd
                  key={key}
                  className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[var(--radius-button)] border border-[color-mix(in_oklch,var(--color-text-inverse)_20%,transparent)] px-1 font-[inherit] opacity-70"
                >
                  {keyLabel(key)}
                </kbd>
              ))}
            </span>
          )}
        </div>,
        document.body,
      )
    : null;

  return { triggerProps, tooltip };
}
