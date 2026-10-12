import { convertFileSrc } from "@tauri-apps/api/core";

import {
  bookHighlightsIn,
  parseBookHighlightId,
  withBookHighlight,
  withoutBookHighlight,
  type BookHighlight,
  type BookLocation,
} from "@/lib/book-highlights";
import { resolveBookNote } from "@/lib/book-import";
import { registerReader } from "@/lib/book-readers";
import {
  currentPageText,
  editPage,
  loadPageText,
  subscribePage,
} from "@/components/editor-area/linked-block-sync";
import { rangeAt, textOffset, type BookSource } from "./book-source";
import { HighlightPainter } from "./highlight-painter";

// Everything a book tab does outside React (SPECs/book-reader-spec.md): load
// the book, find its page, draw the page's highlights onto the book, turn a
// selection into a highlight on the page, and answer the editor's jumps and
// the agent's passage requests. The page is the record; this never stores a
// highlight of its own.

export interface SelectionInfo {
  text: string;
  location: BookLocation;
  rect: DOMRect;
}

export type ReaderStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export class ReaderController {
  readonly bookPath: string;
  notePath: string | null = null;
  #source: BookSource | null = null;
  #painter = new HighlightPainter();
  #highlights: BookHighlight[] = [];
  #cleanups: Array<() => void> = [];
  #pendingJump: string | null = null;
  #repaintFrame = 0;
  #destroyed = false;

  constructor(
    bookPath: string,
    private readonly noteHint: string | null,
    private readonly scroller: HTMLElement,
    private readonly host: HTMLElement,
    private readonly onStatus: (status: ReaderStatus) => void,
  ) {
    this.bookPath = bookPath;
  }

  async start(): Promise<void> {
    try {
      const notePath = await resolveBookNote(this.bookPath, this.noteHint);
      if (this.#destroyed) return;
      this.notePath = notePath;
      this.#cleanups.push(
        subscribePage(notePath, () => void this.#refreshHighlights()),
        registerReader({
          bookPath: this.bookPath,
          notePath,
          passage: async () => {
            const passage = await this.#source?.passage();
            return passage ? { bookPath: this.bookPath, notePath, ...passage } : null;
          },
          jump: (id) => this.jump(id),
        }),
      );
      await this.#refreshHighlights();

      const response = await fetch(convertFileSrc(this.bookPath));
      if (!response.ok) throw new Error(`Couldn't read the book (${response.status})`);
      const data = await response.arrayBuffer();
      if (this.#destroyed) return;
      const hooks = { onSectionShown: () => this.#scheduleRepaint() };
      const open = this.bookPath.toLowerCase().endsWith(".epub")
        ? (await import("./epub-source")).openEpub
        : (await import("./pdf-source")).openPdf;
      const source = await open(data, this.scroller, this.host, hooks);
      if (this.#destroyed) {
        source.destroy();
        return;
      }
      this.#source = source;
      this.onStatus({ kind: "ready" });
      this.#scheduleRepaint();
      if (this.#pendingJump) this.jump(this.#pendingJump);
    } catch (error) {
      console.error(`[book] Couldn't open ${this.bookPath}:`, error);
      if (!this.#destroyed)
        this.onStatus({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
    }
  }

  async #refreshHighlights() {
    const path = this.notePath;
    if (!path) return;
    const text = currentPageText(path) ?? (await loadPageText(path));
    this.#highlights = bookHighlightsIn(text);
    this.#scheduleRepaint();
  }

  #scheduleRepaint() {
    if (this.#repaintFrame) return;
    this.#repaintFrame = requestAnimationFrame(() => {
      this.#repaintFrame = 0;
      this.#repaint();
    });
  }

  #repaint() {
    const source = this.#source;
    if (!source) return;
    const ranges: Range[] = [];
    for (const { location } of this.#highlights) {
      if (location.unit !== source.unit) continue;
      const root = source.textRoot(location.section);
      const range = root && rangeAt(root, location.start, location.end);
      if (range) ranges.push(range);
    }
    this.#painter.paint(ranges);
  }

  /** The current selection as a would-be highlight, or null when there is
   *  none in this book. A selection running past its page ends there. */
  selection(): SelectionInfo | null {
    const source = this.#source;
    const selection = window.getSelection();
    if (!source || !selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const section = source.sectionOf(range.startContainer);
    const root = section === null ? null : source.textRoot(section);
    if (section === null || !root) return null;
    const start = textOffset(root, range.startContainer, range.startOffset);
    const end =
      source.sectionOf(range.endContainer) === section
        ? textOffset(root, range.endContainer, range.endOffset)
        : (root.textContent ?? "").length;
    const text = (root.textContent ?? "").slice(start, end).replace(/\s+/g, " ").trim();
    if (!text || end <= start) return null;
    return {
      text,
      location: { unit: source.unit, section, start, end },
      rect: range.getBoundingClientRect(),
    };
  }

  /** The highlight under a point, for clicks on painted text. */
  highlightAt(x: number, y: number): { highlight: BookHighlight; rect: DOMRect } | null {
    const source = this.#source;
    const caret = document.caretRangeFromPoint?.(x, y);
    if (!source || !caret) return null;
    const section = source.sectionOf(caret.startContainer);
    const root = section === null ? null : source.textRoot(section);
    if (section === null || !root) return null;
    const at = textOffset(root, caret.startContainer, caret.startOffset);
    const highlight = this.#highlights.find(
      ({ location: l }) =>
        l.unit === source.unit && l.section === section && l.start <= at && at < l.end,
    );
    const range = highlight && rangeAt(root, highlight.location.start, highlight.location.end);
    return highlight && range ? { highlight, rect: range.getBoundingClientRect() } : null;
  }

  async addHighlight({ text, location }: SelectionInfo): Promise<void> {
    const path = this.notePath;
    if (!path) return;
    await editPage(path, (page) => ({
      frontmatter: page.frontmatter,
      body: withBookHighlight(page.body, text, location),
    }));
    window.getSelection()?.removeAllRanges();
  }

  async removeHighlight(id: string): Promise<void> {
    const path = this.notePath;
    if (!path) return;
    await editPage(path, (page) => ({
      frontmatter: page.frontmatter,
      body: withoutBookHighlight(page.body, id),
    }));
  }

  /** Scroll to highlight `id` and flash it. */
  jump(id: string): boolean {
    const location = parseBookHighlightId(id);
    if (!location) return false;
    const source = this.#source;
    if (!source) {
      this.#pendingJump = id;
      return true;
    }
    this.#pendingJump = null;
    if (location.unit !== source.unit) return false;
    void source.scrollToSection(location.section).then(() => {
      const root = source.textRoot(location.section);
      const range = root && rangeAt(root, location.start, location.end);
      if (!range) return;
      const rect = range.getBoundingClientRect();
      const box = this.scroller.getBoundingClientRect();
      this.scroller.scrollTop += rect.top - box.top - (box.height - rect.height) / 2;
      this.#painter.flash(range);
    });
    return true;
  }

  async passage() {
    return (await this.#source?.passage()) ?? null;
  }

  destroy() {
    this.#destroyed = true;
    cancelAnimationFrame(this.#repaintFrame);
    for (const cleanup of this.#cleanups) cleanup();
    this.#painter.destroy();
    this.#source?.destroy();
    this.host.replaceChildren();
  }
}
