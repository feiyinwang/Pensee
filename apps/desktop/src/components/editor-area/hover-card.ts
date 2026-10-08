import { type EditorView, ViewPlugin } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import "./wiki-link-preview.css";

// A card that opens beside a hovered link in the editor: `[[page]]` links
// show the page, web links show the site. This owns the hover timing,
// placement and lifecycle; each caller supplies what goes inside.
//
// Hover intent, not hover: the card waits `OPEN_DELAY_MS` so sweeping the
// pointer across a paragraph of links does not flash a card per link, and it
// lingers `CLOSE_DELAY_MS` after the pointer leaves so the pointer can travel
// from the link into the card to scroll it.

const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 200;
/** Matches `--motion-fast`, the card's exit transition (wiki-link-preview.css). */
const EXIT_MS = 100;
const GAP = 6;
const EDGE = 8;

export interface HoverCardContent {
  /** Filled into the card, a flex column. A fragment puts its children
   *  straight into that column. */
  element: Node;
  /** Accessible name of the card. */
  label: string;
  /** Called once the card is gone. */
  destroy?: () => void;
}

export interface HoverCardOptions {
  /** Links under the pointer that open a card. */
  selector: string;
  /** Extra class on the card, for the caller's own layout. */
  className?: string;
  width: number;
  /** Tallest the card gets; it shrinks to the room beside the link. */
  maxHeight: number;
  /** Content for `link`, or null for no card. `isStale` turns true when a
   *  newer hover, a close or the editor going away overtook this one. */
  build: (
    link: HTMLElement,
    view: EditorView,
    isStale: () => boolean,
  ) => Promise<HoverCardContent | null>;
}

class HoverCard {
  private card: HTMLDivElement | null = null;
  private content: HoverCardContent | null = null;
  private link: HTMLElement | null = null;
  private openTimer: number | null = null;
  private closeTimer: number | null = null;
  private removeTimer: number | null = null;
  /** Bumped on every show/hide; an async build that finds it changed lost the
   *  race to a newer hover and throws its result away. */
  private generation = 0;
  private destroyed = false;

  constructor(
    readonly view: EditorView,
    readonly options: HoverCardOptions,
  ) {
    view.contentDOM.addEventListener("mouseover", this.onOver);
    view.contentDOM.addEventListener("mouseout", this.onOut);
    view.contentDOM.addEventListener("mousedown", this.onPress);
    view.contentDOM.addEventListener("keydown", this.onPress);
    window.addEventListener("scroll", this.onScroll, true);
    window.addEventListener("keydown", this.onKey);
  }

  private readonly onOver = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.<HTMLElement>(this.options.selector);
    if (!link) return;
    this.cancelClose();
    if (link === this.link && this.card) return;
    this.cancelOpen();
    this.openTimer = window.setTimeout(() => {
      this.openTimer = null;
      void this.show(link);
    }, OPEN_DELAY_MS);
  };

  private readonly onOut = (event: MouseEvent) => {
    const from = (event.target as Element | null)?.closest?.(this.options.selector);
    if (!from) return;
    const to = event.relatedTarget;
    if (to instanceof Node && (from.contains(to) || this.card?.contains(to))) return;
    this.cancelOpen();
    this.scheduleClose();
  };

  /** Clicking or typing in the editor means the reader moved on. */
  private readonly onPress = () => {
    this.cancelOpen();
    this.hide();
  };

  /** The card is fixed to the window; when the page scrolls under it, the
   *  link it points at moves away. Scrolling inside the card is reading it. */
  private readonly onScroll = (event: Event) => {
    if (!this.card) return;
    if (event.target instanceof Node && this.card.contains(event.target)) return;
    this.hide();
  };

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.card) this.hide();
  };

  private cancelOpen() {
    if (this.openTimer !== null) window.clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private cancelClose() {
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  private scheduleClose() {
    if (this.closeTimer !== null) return;
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      this.hide();
    }, CLOSE_DELAY_MS);
  }

  private async show(link: HTMLElement) {
    const generation = ++this.generation;
    if (!link.isConnected) return;
    const isStale = () => generation !== this.generation || this.destroyed || !link.isConnected;
    let content: HoverCardContent | null = null;
    try {
      content = await this.options.build(link, this.view, isStale);
    } catch (error) {
      console.error("[editor] Failed to build hover card:", error);
    }
    if (!content) return;
    if (isStale()) {
      content.destroy?.();
      return;
    }

    this.teardownCard();
    this.link = link;
    this.content = content;
    const card = document.createElement("div");
    card.className = `surface-card wr-link-preview ${this.options.className ?? ""}`.trim();
    card.dataset.state = "closed";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", content.label);
    card.addEventListener("mouseenter", () => this.cancelClose());
    card.addEventListener("mouseleave", (event) => {
      if (event.relatedTarget instanceof Node && this.link?.contains(event.relatedTarget)) return;
      this.scheduleClose();
    });
    // Buttons marked `data-hover-card-close` close the card as they act.
    // Capture phase: the buttons stop their clicks from bubbling.
    card.addEventListener(
      "click",
      (event) => {
        if (event.target instanceof Element && event.target.closest("[data-hover-card-close]")) {
          this.hide();
        }
      },
      true,
    );
    card.append(content.element);
    this.card = card;
    document.body.append(card);
    this.place(link, card);
    // Paint once closed, then open, so the entrance transition runs.
    requestAnimationFrame(() => {
      if (this.card === card) card.dataset.state = "open";
    });
  }

  /** Below the link, or above it when there is more room there; the card's
   *  height shrinks to the room available, and it scrolls inside. */
  private place(link: HTMLElement, card: HTMLDivElement) {
    const { width: cardWidth, maxHeight } = this.options;
    const rect = link.getBoundingClientRect();
    const width = Math.min(cardWidth, window.innerWidth - EDGE * 2);
    const left = Math.min(Math.max(rect.left, EDGE), window.innerWidth - width - EDGE);
    const below = window.innerHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;
    const placeBelow = below >= Math.min(maxHeight, 200) || below >= above;
    card.style.width = `${width}px`;
    card.style.left = `${left}px`;
    card.style.maxHeight = `${Math.min(maxHeight, placeBelow ? below : above)}px`;
    if (placeBelow) {
      card.style.top = `${rect.bottom + GAP}px`;
    } else {
      card.style.bottom = `${window.innerHeight - rect.top + GAP}px`;
    }
    // Grow out of the link, not out of the card's centre.
    card.style.transformOrigin = `${rect.left - left}px ${placeBelow ? "top" : "bottom"}`;
  }

  hide() {
    this.generation++;
    this.cancelClose();
    this.link = null;
    const card = this.card;
    if (!card) return;
    this.card = null;
    card.dataset.state = "closed";
    const content = this.content;
    this.content = null;
    this.removeTimer = window.setTimeout(() => {
      content?.destroy?.();
      card.remove();
    }, EXIT_MS);
  }

  /** Replace the card at once, without an exit — the next one is on its way. */
  private teardownCard() {
    this.content?.destroy?.();
    this.content = null;
    this.card?.remove();
    this.card = null;
  }

  destroy() {
    this.destroyed = true;
    this.cancelOpen();
    this.cancelClose();
    if (this.removeTimer !== null) window.clearTimeout(this.removeTimer);
    this.teardownCard();
    this.view.contentDOM.removeEventListener("mouseover", this.onOver);
    this.view.contentDOM.removeEventListener("mouseout", this.onOut);
    this.view.contentDOM.removeEventListener("mousedown", this.onPress);
    this.view.contentDOM.removeEventListener("keydown", this.onPress);
    window.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("keydown", this.onKey);
  }
}

export function hoverCard(options: HoverCardOptions): Extension {
  return ViewPlugin.define((view) => new HoverCard(view, options));
}
