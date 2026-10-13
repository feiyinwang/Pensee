import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  foldableSyntaxFacet,
  selectAllDecorationsOnSelectExtension,
} from "@/lib/prosemark-core/main";
import { selectionTouchesRange } from "@/lib/prosemark-core/utils";
import { fetchLinkPreview, type LinkPreview } from "@/lib/tauri";
import { hoverCard } from "./hover-card";
import "./link-preview.css";

/** A line holding nothing but a web address, bare or in angle brackets. */
const BARE_URL_LINE = /^\s*<?(https?:\/\/[^\s<>]+?)>?\s*$/i;

export function bareUrlOfLine(text: string): string | null {
  const match = BARE_URL_LINE.exec(text);
  if (!match) return null;
  return URL.canParse(match[1]) ? match[1] : null;
}

// One request per URL for the life of the app, shared by every frame showing
// it. Failures are cached too, so a dead link is not re-fetched on every
// rebuild.
const previewCache = new Map<string, Promise<LinkPreview>>();

function loadPreview(url: string): Promise<LinkPreview> {
  let pending = previewCache.get(url);
  if (!pending) {
    pending = fetchLinkPreview(url);
    previewCache.set(url, pending);
  }
  return pending;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function openExternally(url: string) {
  void openUrl(url).catch((error) => {
    console.error("[link-preview] Failed to open link:", error);
  });
}

// The page keeps its own origin (`allow-same-origin`) so logins, storage and
// scripts work as in a browser; that origin is never the editor's, so it still
// cannot reach the editor document or Tauri's IPC. No `allow-top-navigation`,
// so a link in the page cannot navigate the Pensée window away.
const SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

const ICONS = {
  reload: ["M20 12a8 8 0 11-2.3-5.7", "M20 4v4.3h-4.3"],
  open: ["M14 5h5v5", "M19 5l-8 8", "M17 13v6H5V7h6"],
  edit: ["M4 20h4L19 9l-4-4L4 16z", "M13 7l4 4"],
  link: [
    "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1",
    "M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  ],
};

function svgIcon(icon: string[]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of icon) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function makeButton(icon: string[], label: string, onClick: () => void): HTMLButtonElement {
  const button = element("button", "cm-link-preview-button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(svgIcon(icon));
  // Keep the editor focused; see docs/editor.md "Buttons inside widgets".
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

// Fixed size whatever loads into it, so the page arriving never shifts the
// text below. Keep in sync with link-preview.css.
const HEADER_HEIGHT = 32;
const BODY_HEIGHT = 480;
const FRAME_CHROME = 2 + 12; // top/bottom border + vertical margin

/** The site's own summary, for pages that refuse to be framed. */
function fallbackCard(preview: LinkPreview, url: string): HTMLElement {
  const card = element("div", "cm-link-preview-fallback");
  if (preview.image) {
    const image = element("img", "cm-link-preview-fallback-image");
    image.alt = "";
    image.src = preview.image;
    image.addEventListener("error", () => image.remove());
    card.append(image);
  }
  const text = element("div", "cm-link-preview-fallback-text");
  const title = element("div", "cm-link-preview-fallback-title");
  title.textContent = preview.title ?? hostOf(preview.url);
  text.append(title);
  if (preview.description) {
    const description = element("div", "cm-link-preview-fallback-description");
    description.textContent = preview.description;
    text.append(description);
  }
  const note = element("div", "cm-link-preview-note");
  note.textContent = `${hostOf(preview.url)} doesn't allow its pages to be shown inside other apps.`;
  const open = element("button", "cm-link-preview-open");
  open.type = "button";
  open.textContent = "Open in browser";
  open.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  open.addEventListener("click", () => openExternally(url));
  text.append(note, open);
  card.append(text);
  return card;
}

/** The page at `url` in a sandboxed frame under a title / reload / open
 *  header, or the site's own summary when it refuses to be framed. */
function linkFrame(url: string, onEdit?: () => void): HTMLElement {
  const root = element("div", "cm-link-preview");
  root.dataset.state = "loading";

  const header = element("div", "cm-link-preview-header");
  const icon = element("img", "cm-link-preview-icon");
  icon.alt = "";
  icon.hidden = true;
  icon.addEventListener("load", () => (icon.hidden = false));
  icon.addEventListener("error", () => (icon.hidden = true));
  const title = element("span", "cm-link-preview-title");
  title.textContent = url;
  title.title = url;
  const host = element("span", "cm-link-preview-host");
  host.textContent = hostOf(url);

  const body = element("div", "cm-link-preview-body");
  const status = element("div", "cm-link-preview-status");
  status.textContent = "Loading…";
  body.append(status);

  let iframe: HTMLIFrameElement | null = null;
  const reload = makeButton(ICONS.reload, "Reload page", () => {
    if (!iframe) return;
    const src = iframe.src;
    iframe.src = "about:blank";
    requestAnimationFrame(() => {
      if (iframe?.isConnected) iframe.src = src;
    });
  });
  reload.hidden = true;
  const open = makeButton(ICONS.open, "Open in browser", () => openExternally(url));
  open.dataset.hoverCardClose = "";
  header.append(icon, title, host);
  if (onEdit) {
    const edit = makeButton(ICONS.edit, "Edit link", onEdit);
    edit.dataset.hoverCardClose = "";
    header.append(edit);
  }
  header.append(reload, open);
  root.append(header, body);

  const showFrame = () => {
    root.dataset.state = "frame";
    iframe = element("iframe", "cm-link-preview-iframe");
    iframe.setAttribute("sandbox", SANDBOX);
    iframe.referrerPolicy = "no-referrer";
    iframe.title = url;
    iframe.src = url;
    body.replaceChildren(iframe);
    reload.hidden = false;
  };

  loadPreview(url).then(
    (preview) => {
      if (preview.title) title.textContent = preview.title;
      if (preview.icon) icon.src = preview.icon;
      if (preview.embeddable) {
        showFrame();
      } else {
        root.dataset.state = "fallback";
        body.replaceChildren(fallbackCard(preview, url));
      }
    },
    // The header check failed (bot wall, odd status, offline). The browser
    // engine may still load it, and if not, its own error page is the
    // honest answer, so try the frame anyway.
    (error: unknown) => {
      console.warn("[link-preview] Preview request failed, framing anyway:", error);
      showFrame();
    },
  );

  return root;
}

class LinkPreviewWidget extends WidgetType {
  constructor(public url: string) {
    super();
  }

  eq(other: LinkPreviewWidget): boolean {
    return this.url === other.url;
  }

  get estimatedHeight(): number {
    return HEADER_HEIGHT + BODY_HEIGHT + FRAME_CHROME;
  }

  toDOM() {
    return linkFrame(this.url);
  }

  // Buttons and the page itself keep their events; a press anywhere else on
  // the frame reaches the editor, which reveals the URL for editing.
  ignoreEvent(event: Event) {
    return (
      event.target instanceof Element &&
      event.target.closest("button, iframe, .cm-link-preview-body") !== null
    );
  }
}

function buildDecorations(
  state: EditorState,
  node: SyntaxNodeRef,
): Range<Decoration>[] | undefined {
  const decorations: Range<Decoration>[] = [];
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n);
    const url = bareUrlOfLine(line.text);
    if (!url) continue;
    const widget = new LinkPreviewWidget(url);
    // Selection on the line shows the source with the page under it, the
    // same unfold the images use; elsewhere the page stands in for the line.
    if (selectionTouchesRange(state.selection.ranges, line)) {
      decorations.push(Decoration.widget({ widget, block: true, side: 1 }).range(line.to));
    } else {
      decorations.push(Decoration.replace({ widget, block: true }).range(line.from, line.to));
    }
  }
  return decorations.length > 0 ? decorations : undefined;
}

/** Live page previews for links on a line of their own — what pasting a link
 *  onto an empty line gives you. The markdown stays a plain URL. Only
 *  top-level paragraphs: a URL inside a list item or quote keeps rendering as
 *  a link. */
export function linkPreviews() {
  return [
    foldableSyntaxFacet.of({
      nodePath: "Document/Paragraph",
      // Each line decides for itself whether the selection touches it.
      keepDecorationOnUnfold: true,
      buildDecorations,
    }),
    selectAllDecorationsOnSelectExtension(
      "cm-link-preview",
      (target) => target.closest("button, .cm-link-preview-body") !== null,
    ),
  ];
}

/** Web address of a bare URL in running text: `http(s)://…` as written, or
 *  `www.…` read as https. Anything else (mail addresses, other schemes) is
 *  left as text. */
export function webUrlOf(text: string): string | null {
  const url = /^www\./i.test(text) ? `https://${text}` : text;
  return /^https?:\/\//i.test(url) && URL.canParse(url) ? url : null;
}

/** A web address in running text, drawn as a link icon. Clicking it opens
 *  the page; hovering shows it (`webLinkCard`). */
class LinkChipWidget extends WidgetType {
  constructor(public url: string) {
    super();
  }

  eq(other: LinkChipWidget): boolean {
    return this.url === other.url;
  }

  toDOM() {
    const chip = element("span", "cm-link-chip");
    chip.dataset.url = this.url;
    chip.setAttribute("role", "link");
    chip.setAttribute("aria-label", this.url);
    chip.append(svgIcon(ICONS.link));
    // Claim the press so the editor neither moves the caret here (which
    // would unfold the URL under the pointer) nor runs its own link click.
    chip.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openExternally(this.url);
    });
    return chip;
  }

  ignoreEvent() {
    return true;
  }
}

/** The span a bare URL node stands for: the whole `<…>` of an autolink, the
 *  URL itself otherwise. Null for URLs that belong to `[text](url)` links
 *  and images, which render their own way. */
function chipRange(node: SyntaxNodeRef): { from: number; to: number } | null {
  const parent = node.node.parent;
  if (!parent || parent.name === "Link" || parent.name === "Image") return null;
  return parent.name === "Autolink" ? parent : node;
}

/** A URL alone on a top-level paragraph line gets the full page preview
 *  (`linkPreviews`) instead of a chip. */
function hasBlockPreview(state: EditorState, node: SyntaxNodeRef): boolean {
  if (!bareUrlOfLine(state.doc.lineAt(node.from).text)) return false;
  let ancestor = node.node.parent;
  while (ancestor && ancestor.name !== "Paragraph") ancestor = ancestor.parent;
  return ancestor?.parent?.name === "Document";
}

const CHIP_CARD_WIDTH = 560;
const CHIP_CARD_HEIGHT = HEADER_HEIGHT + 400;

/** Web addresses in running text collapse to a link icon; the URL comes
 *  back as text when the caret reaches it. Hovering the icon shows the page
 *  in a card, the same frame (or summary) a link on its own line gets. */
export function linkChips(): Extension {
  return [
    foldableSyntaxFacet.of({
      nodePath: "URL",
      unfoldZone: (_state, node) => chipRange(node) ?? node,
      buildDecorations: (state, node) => {
        const range = chipRange(node);
        if (!range || hasBlockPreview(state, node)) return;
        const url = webUrlOf(state.doc.sliceString(node.from, node.to));
        if (!url) return;
        return Decoration.replace({ widget: new LinkChipWidget(url) }).range(range.from, range.to);
      },
    }),
    hoverCard({
      selector: ".cm-link-chip",
      className: "wr-web-link-card",
      width: CHIP_CARD_WIDTH,
      maxHeight: CHIP_CARD_HEIGHT,
      build: async (chip, view) => {
        const url = chip.dataset.url;
        if (!url) return null;
        // Caret at the start of the link unfolds it into editable text.
        const edit = () => {
          if (!chip.isConnected) return;
          view.dispatch({ selection: { anchor: view.posAtDOM(chip) } });
          view.focus();
        };
        return { element: linkFrame(url, edit), label: `Preview of ${url}` };
      },
    }),
  ];
}

export const __testLinkPreview = { LinkPreviewWidget, LinkChipWidget, previewCache };
