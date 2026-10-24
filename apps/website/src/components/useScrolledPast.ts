import { useEffect, useRef, useState } from "react";

/** The floating bar's bottom edge (12px inset + 56px tall): an element above
    it counts as scrolled past. */
const BAR_BOTTOM = 68;

/**
 * Whether the element has scrolled up out of view, under the sticky bar.
 * Below the viewport (not reached yet) doesn't count. False until the page
 * runs JavaScript, which is also the prerendered state.
 */
export function useScrolledPast<T extends Element>() {
  const ref = useRef<T>(null);
  const [past, setPast] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setPast(!entry.isIntersecting && entry.boundingClientRect.bottom <= BAR_BOTTOM);
      },
      { rootMargin: `-${BAR_BOTTOM}px 0px 0px 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, past] as const;
}
