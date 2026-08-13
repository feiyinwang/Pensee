/**
 * Why the gutter grip did — or did not — appear under the pointer.
 * Off unless `localStorage.setItem("writer.gripDebug", "1")`.
 *
 * It exists because "no handle shows up here" is the one bug report that cannot
 * be reasoned about from the source. `place()` has nine exits and eight of them
 * look identical from outside the window: the grip simply is not there. Which
 * exit ran decides what to fix — a band that never matched its selector, a
 * `posAtCoords` landing inside a widget, two source lines the parser folded
 * into one block, or a frozen grip because the panel is open. Guessing between
 * them costs a round trip each time.
 *
 * Same shape as `band-debug.ts`: descriptive only. Nothing here changes layout
 * or behaviour, and every call site is a one-liner next to the exit it names.
 */

export function gripDebugEnabled(): boolean {
  try {
    return localStorage.getItem("writer.gripDebug") === "1";
  } catch {
    // Private mode / disabled storage. The probe is an aid, never a dependency.
    return false;
  }
}

/** The pointer moves continuously, so an unthrottled log is unreadable. Only
 *  the moment the VERDICT changes is interesting — hovering one paragraph for
 *  two seconds is one line, not two hundred. */
let last = "";

/**
 * @param verdict  which exit of `place()` ran — the thing you are here to read
 * @param detail   whatever identifies the thing under the pointer for that exit
 */
export function gripTrace(verdict: string, detail?: Record<string, unknown>): void {
  if (!gripDebugEnabled()) return;
  const key = verdict + JSON.stringify(detail ?? {});
  if (key === last) return;
  last = key;
  // eslint-disable-next-line no-console
  console.log(`[grip] ${verdict}`, detail ?? {});
}

/** A short, readable name for the element the pointer is actually over —
 *  `event.target` is usually a nameless span, and its ancestry is the story. */
export function describeTarget(el: Element | null): string {
  if (!el) return "none";
  const parts: string[] = [];
  for (let node: Element | null = el; node && parts.length < 5; node = node.parentElement) {
    const cls = node.classList.length ? `.${[...node.classList].join(".")}` : "";
    const band = node instanceof HTMLElement ? node.dataset.wrBand : undefined;
    parts.push(`${node.tagName.toLowerCase()}${cls}${band ? `[band=${band}]` : ""}`);
    if (node.classList.contains("cm-content")) break;
  }
  return parts.join(" < ");
}
