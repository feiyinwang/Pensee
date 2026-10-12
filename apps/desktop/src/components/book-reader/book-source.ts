// What the reader needs from a book format (SPECs/book-reader-spec.md). A
// book is a run of sections — PDF pages, EPUB spine items — each with a text
// root whose text nodes give highlight offsets. A section's root exists only
// while it is rendered.

export interface BookSourceHooks {
  /** Section `section`'s text root is in the DOM (paint its highlights). */
  onSectionShown: (section: number) => void;
}

export interface BookSource {
  unit: "p" | "s";
  /** The section's text root, or null while it is not rendered. */
  textRoot: (section: number) => HTMLElement | null;
  /** The section's box in the scroller, rendered or not (a PDF page's
   *  placeholder): where the reading place is measured from. */
  sectionElement: (section: number) => HTMLElement | null;
  /** The section a DOM node belongs to. */
  sectionOf: (node: Node) => number | null;
  /** Bring the section into view; resolves once its text root is rendered. */
  scrollToSection: (section: number) => Promise<void>;
  /** The section at the middle of the viewport. */
  currentSection: () => number;
  /** Lay out now every section in or near the view that the browser would
   *  otherwise lay out a frame or more later, so their real heights are in
   *  place before the reader measures. True when it laid out any. */
  layOutInView: () => boolean;
  /** For the agent: the text on screen and where it is. */
  passage: () => Promise<{ where: string; text: string }>;
  destroy: () => void;
}

/** The agent gets this much of a passage at most. */
export const MAX_PASSAGE_CHARS = 12_000;

/** Characters of text in `root` before (node, offset). */
export function textOffset(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** The DOM range for characters [start, end) of `root`'s text, or null when
 *  the text is shorter. */
export function rangeAt(root: Node, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node as Text).data.length;
    if (!started && start < seen + length) {
      range.setStart(node, start - seen);
      started = true;
    }
    if (started && end <= seen + length) {
      range.setEnd(node, end - seen);
      return range;
    }
    seen += length;
  }
  return null;
}
