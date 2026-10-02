import { EditorView, ViewPlugin } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import {
  codeBlockDecorationsExtension,
  defaultFoldableSyntaxExtensions,
  defaultHideExtensions,
  fixedTabWidthExtension,
  listExtension,
  prosemarkBaseThemeSetup,
  prosemarkMarkdownSyntaxExtensions,
} from "@/lib/prosemark-core/main";
import * as tauri from "@/lib/tauri";
import { parseDocument } from "@/lib/frontmatter";
import { getFileStem } from "@/lib/paths";
import { findWikiLinkAt, parseWikiLink } from "@/lib/wiki-links";
import { findWikiPage, pageNameFromWikiTarget } from "@/lib/wiki-pages";
import { getWorkspaceRoot } from "@/hooks/workspace-api";
import * as editorApi from "@/hooks/editor-api";
import { headingDecorations } from "./heading-decorations";
import { imageSrcResolver } from "./image-src-resolver";
import { wikiLinkExtension } from "./wiki-link-extension";
import "./wiki-link-preview.css";

// Hovering a rendered `[[page]]` link shows that page in a card beside it: the
// page's own text in a read-only editor, so it looks exactly like the page
// does (headings, lists, pictures, links), in a box you can scroll to read.
//
// Hover intent, not hover: the card waits `OPEN_DELAY_MS` so sweeping the
// pointer across a paragraph of links does not flash a card per link, and it
// lingers `CLOSE_DELAY_MS` after the pointer leaves so the pointer can travel
// from the link into the card to scroll it.

const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 200;
/** Matches `--motion-fast`, the card's exit transition (wiki-link-preview.css). */
const EXIT_MS = 100;
const CARD_WIDTH = 440;
const CARD_MAX_HEIGHT = 380;
const GAP = 6;
const EDGE = 8;

function previewExtensions(path: string, isDisposed: () => boolean): Extension[] {
  return [
    markdown({ codeLanguages: languages, extensions: [GFM, prosemarkMarkdownSyntaxExtensions] }),
    defaultHideExtensions,
    defaultFoldableSyntaxExtensions,
    listExtension,
    fixedTabWidthExtension,
    codeBlockDecorationsExtension,
    headingDecorations,
    imageSrcResolver(() => path),
    // Links inside the preview work too: a click opens that page.
    wikiLinkExtension(() => path, isDisposed),
    EditorView.lineWrapping,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    prosemarkBaseThemeSetup(),
  ];
}

/** Text of the page at `path`: an open tab's (it may hold unsaved edits),
 *  else the file on disk. Frontmatter is left out; it is metadata, not the
 *  page. */
async function pageBody(path: string): Promise<string> {
  const open = editorApi.getOpenFile(path);
  if (open && !open.isLoading) return open.content;
  return parseDocument((await tauri.readFile(path)).content, path).body;
}

class LinkPreview {
  private card: HTMLDivElement | null = null;
  private inner: EditorView | null = null;
  private link: HTMLElement | null = null;
  private openTimer: number | null = null;
  private closeTimer: number | null = null;
  private removeTimer: number | null = null;
  /** Bumped on every show/hide; an async load that finds it changed lost the
   *  race to a newer hover and throws its result away. */
  private generation = 0;
  private destroyed = false;

  constructor(
    readonly view: EditorView,
    readonly getFilePath: () => string,
  ) {
    view.contentDOM.addEventListener("mouseover", this.onOver);
    view.contentDOM.addEventListener("mouseout", this.onOut);
    view.contentDOM.addEventListener("mousedown", this.onPress);
    view.contentDOM.addEventListener("keydown", this.onPress);
    window.addEventListener("scroll", this.onScroll, true);
    window.addEventListener("keydown", this.onKey);
  }

  private readonly onOver = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.<HTMLElement>(".cm-wiki-link");
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
    const from = (event.target as Element | null)?.closest?.(".cm-wiki-link");
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
    const root = getWorkspaceRoot();
    if (!root || !link.isConnected) return;
    let inner: string | null = null;
    try {
      inner = findWikiLinkAt(this.view.state.doc, this.view.posAtDOM(link))?.inner ?? null;
    } catch {
      return; // The widget left the document between hover and timer.
    }
    if (!inner) return;
    const name = pageNameFromWikiTarget(inner);
    const currentFile = this.getFilePath() || null;

    let path: string | null = null;
    let body: string | null = null;
    try {
      // Looking only — a hover never creates a page. Clicking does.
      path = name ? await findWikiPage(name, root, currentFile, tauri) : null;
      if (path) body = await pageBody(path);
    } catch (error) {
      console.error("[editor] Failed to load link preview:", error);
    }
    if (generation !== this.generation || this.destroyed || !link.isConnected) return;

    this.teardownCard();
    this.link = link;
    const title = path ? getFileStem(path) : (name ?? parseWikiLink(inner).displayText);
    this.card = this.buildCard(title, path, body);
    document.body.append(this.card);
    this.place(link, this.card);
    // Paint once closed, then open, so the entrance transition runs.
    const card = this.card;
    requestAnimationFrame(() => {
      if (this.card === card) card.dataset.state = "open";
    });
  }

  private buildCard(title: string, path: string | null, body: string | null): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "surface-card wr-link-preview";
    card.dataset.state = "closed";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", `Preview of ${title}`);
    card.addEventListener("mouseenter", () => this.cancelClose());
    card.addEventListener("mouseleave", (event) => {
      if (event.relatedTarget instanceof Node && this.link?.contains(event.relatedTarget)) return;
      this.scheduleClose();
    });

    const header = document.createElement("button");
    header.type = "button";
    header.className = "wr-link-preview-title";
    header.textContent = title;
    header.title = path ? "Open page" : "";
    header.disabled = !path;
    header.addEventListener("click", () => {
      if (!path) return;
      this.hide();
      void editorApi.openLinkedPage(path);
    });
    card.append(header);

    const scroller = document.createElement("div");
    scroller.className = "wr-link-preview-body";
    card.append(scroller);

    if (!path) {
      scroller.append(this.note("No page yet. Click the link to create it."));
    } else if (body === null) {
      scroller.append(this.note("Could not read this page."));
    } else if (!body.trim()) {
      scroller.append(this.note("This page is empty."));
    } else {
      const host = document.createElement("div");
      host.dataset.inlineEditor = "";
      scroller.append(host);
      this.inner = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: body,
          extensions: previewExtensions(path, () => this.destroyed || this.inner === null),
        }),
      });
    }
    return card;
  }

  private note(text: string): HTMLElement {
    const note = document.createElement("p");
    note.className = "wr-link-preview-note";
    note.textContent = text;
    return note;
  }

  /** Below the link, or above it when there is more room there; the card's
   *  height shrinks to the room available, and it scrolls inside. */
  private place(link: HTMLElement, card: HTMLDivElement) {
    const rect = link.getBoundingClientRect();
    const width = Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2);
    const left = Math.min(Math.max(rect.left, EDGE), window.innerWidth - width - EDGE);
    const below = window.innerHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;
    const placeBelow = below >= Math.min(CARD_MAX_HEIGHT, 200) || below >= above;
    card.style.width = `${width}px`;
    card.style.left = `${left}px`;
    card.style.maxHeight = `${Math.min(CARD_MAX_HEIGHT, placeBelow ? below : above)}px`;
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
    const inner = this.inner;
    this.inner = null;
    this.removeTimer = window.setTimeout(() => {
      inner?.destroy();
      card.remove();
    }, EXIT_MS);
  }

  /** Replace the card at once, without an exit — the next one is on its way. */
  private teardownCard() {
    this.inner?.destroy();
    this.inner = null;
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

export function wikiLinkPreview(getFilePath: () => string): Extension {
  return ViewPlugin.define((view) => new LinkPreview(view, getFilePath));
}
