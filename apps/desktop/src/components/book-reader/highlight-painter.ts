// Highlights are painted with the CSS Custom Highlight API: ranges over the
// book's own text, so painting never adds spans or touches the DOM. One
// registry entry per style, shared by every open reader; each reader owns its
// ranges in it. Styled by `::highlight(book-highlight)` in book-reader.css.

const HIGHLIGHT = "book-highlight";
const FLASH = "book-flash";
const FLASH_MS = 1200;

function registry(name: string): Highlight | null {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return null;
  let highlight = CSS.highlights.get(name);
  if (!highlight) {
    highlight = new Highlight();
    CSS.highlights.set(name, highlight);
  }
  return highlight;
}

export class HighlightPainter {
  #ranges = new Set<Range>();
  #flash: { range: Range; timer: ReturnType<typeof setTimeout> } | null = null;

  /** Replace this reader's highlights with `ranges`. */
  paint(ranges: Range[]) {
    const highlight = registry(HIGHLIGHT);
    if (!highlight) return;
    for (const range of this.#ranges) highlight.delete(range);
    this.#ranges = new Set(ranges);
    for (const range of ranges) highlight.add(range);
  }

  flash(range: Range) {
    const highlight = registry(FLASH);
    if (!highlight) return;
    this.#clearFlash();
    highlight.add(range);
    this.#flash = { range, timer: setTimeout(() => this.#clearFlash(), FLASH_MS) };
  }

  #clearFlash() {
    if (!this.#flash) return;
    clearTimeout(this.#flash.timer);
    registry(FLASH)?.delete(this.#flash.range);
    this.#flash = null;
  }

  destroy() {
    this.paint([]);
    this.#clearFlash();
  }
}
