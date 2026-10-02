/**
 * Stacked pages render each page in a "slot": a keyed element that owns one
 * editor. Slots exist so the editor survives page changes that are really a
 * swap (navigating the single page to another file, or reshaping the stack
 * via back/forward) instead of tearing down and rebuilding a CodeMirror view.
 *
 * Slots also keep a stable DOM order: a slot is appended when created and
 * never moved, and the visual order comes from CSS `order`. Moving a DOM node
 * would reset the scroll position of the page inside it.
 */
export interface PageSlot {
  slot: string;
  path: string;
  /** Created by this assignment rather than reused. */
  fresh: boolean;
}

export function assignPageSlots(
  previous: readonly PageSlot[],
  previousFocus: string | null,
  pages: readonly string[],
  focus: string,
  createId: () => string,
): PageSlot[] {
  const wanted = new Set(pages);
  const kept = new Map<string, string>();
  const freed: string[] = [];
  for (const entry of previous) {
    if (wanted.has(entry.path)) kept.set(entry.path, entry.slot);
    // The focused page's slot is reused first: it is the one on screen.
    else if (entry.path === previousFocus) freed.unshift(entry.slot);
    else freed.push(entry.slot);
  }

  const incoming = pages.filter((p) => !kept.has(p));
  const assigned = new Map<string, { slot: string; fresh: boolean }>();
  // ...and it goes to the page taking focus, so a swap lands in place.
  const reusers = incoming.includes(focus)
    ? [focus, ...incoming.filter((p) => p !== focus)]
    : incoming;
  for (const path of reusers) {
    const reused = freed.shift();
    if (!reused) break;
    assigned.set(path, { slot: reused, fresh: false });
  }
  for (const path of incoming) {
    if (!assigned.has(path)) assigned.set(path, { slot: createId(), fresh: true });
  }

  const bySlot = new Map<string, PageSlot>();
  for (const [path, slot] of kept) bySlot.set(slot, { slot, path, fresh: false });
  for (const [path, { slot, fresh }] of assigned) bySlot.set(slot, { slot, path, fresh });

  const result: PageSlot[] = [];
  for (const entry of previous) {
    const next = bySlot.get(entry.slot);
    if (next) result.push(next);
  }
  for (const entry of bySlot.values()) if (entry.fresh) result.push(entry);
  return result;
}
