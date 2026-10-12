import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { closeComposer } from "@/hooks/use-composer";
import ComposerCard from "./composer-card";

// ⌘T's composer over the page. Lazy with the card, so Arc loads on first use.
//
// A floating card, not a Radix dialog. A modal Radix dialog sets
// `pointer-events: none` on <body> and the chips' Arc menus and calendar come
// with other copies of Radix's layer code: the calendar took no clicks, the
// window could stay unclickable after closing, and one Esc closed a menu and
// the box together (or neither). Here Esc and an outside click close the box
// only when no menu took them first: Radix's layers listen in the capture
// phase and mark the key handled, these listeners run after, in the bubble.
export default function ComposerDialog() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeComposer();
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // The chips' menus and calendar render outside the card: still the box.
      if (ref.current?.contains(target) || target.closest("[data-radix-popper-content-wrapper]")) {
        return;
      }
      closeComposer();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return createPortal(
    <div ref={ref} role="dialog" aria-label="New note" className="composer-dialog surface-card">
      <ComposerCard variant="dialog" onClose={closeComposer} />
    </div>,
    document.body,
  );
}
