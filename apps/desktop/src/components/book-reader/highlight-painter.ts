// Highlights are painted with the CSS Custom Highlight API: ranges over the
// book's own text, so painting never adds spans or touches the DOM. One
// registry entry per style, shared by every open reader; each reader owns its
// ranges in it. Styled by `::highlight(book-highlight)` in book-reader.css.
//
// A reader's ranges are in the registry only while its tab is shown. WebKit
// re-validates every registered range on each rendering update, and in a
// hidden tab (visibility: hidden) no position is a caret candidate, so it
// walks the book's text a character at a time: about half a second per frame
// after any change anywhere in the window.

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
  #shown = true;
  #flash: { range: Range; timer: ReturnType<typeof setTimeout> } | null = null;

  /** Replace this reader's highlights with `ranges`. */
  paint(ranges: Range[]) {
    this.#unregister();
    this.#ranges = new Set(ranges);
    this.#register();
  }

  /** Register this reader's ranges while its tab shows, and drop them while
   *  it is hidden. */
  setShown(shown: boolean) {
    if (shown === this.#shown) return;
    this.#shown = shown;
    if (shown) this.#register();
    else {
      this.#unregister();
      this.#clearFlash();
    }
  }

  #register() {
    if (!this.#shown) return;
    const highlight = registry(HIGHLIGHT);
    if (highlight) for (const range of this.#ranges) highlight.add(range);
  }

  #unregister() {
    const highlight = registry(HIGHLIGHT);
    if (highlight) for (const range of this.#ranges) highlight.delete(range);
  }

  flash(range: Range) {
    const highlight = this.#shown ? registry(FLASH) : null;
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
