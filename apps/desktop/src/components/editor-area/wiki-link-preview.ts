import { EditorView } from "@codemirror/view";
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
import { hoverCard, type HoverCardContent } from "./hover-card";

// Hovering a rendered `[[page]]` link shows that page in a card beside it: the
// page's own text in a read-only editor, so it looks exactly like the page
// does (headings, lists, pictures, links), in a box you can scroll to read.
// Hover timing and placement live in `hover-card.ts`.

const CARD_WIDTH = 440;
const CARD_MAX_HEIGHT = 380;

/** A read-only editor that looks like the page: shared with the backlink
 *  previews (block-backlinks.ts). */
export function previewExtensions(path: string, isDisposed: () => boolean): Extension[] {
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

function note(text: string): HTMLElement {
  const note = document.createElement("p");
  note.className = "wr-link-preview-note";
  note.textContent = text;
  return note;
}

async function buildPreview(
  link: HTMLElement,
  view: EditorView,
  isStale: () => boolean,
  getFilePath: () => string,
): Promise<HoverCardContent | null> {
  const root = getWorkspaceRoot();
  if (!root) return null;
  let inner: string | null = null;
  try {
    inner = findWikiLinkAt(view.state.doc, view.posAtDOM(link))?.inner ?? null;
  } catch {
    return null; // The widget left the document between hover and timer.
  }
  if (!inner) return null;
  const name = pageNameFromWikiTarget(inner);
  const currentFile = getFilePath() || null;

  let path: string | null = null;
  let body: string | null = null;
  try {
    // Looking only — a hover never creates a page. Clicking does.
    path = name ? await findWikiPage(name, root, currentFile, tauri) : null;
    if (path) body = await pageBody(path);
  } catch (error) {
    console.error("[editor] Failed to load link preview:", error);
  }
  if (isStale()) return null;

  const title = path ? getFileStem(path) : (name ?? parseWikiLink(inner).displayText);
  const content = document.createDocumentFragment();

  const header = document.createElement("button");
  header.type = "button";
  header.className = "wr-link-preview-title";
  header.textContent = title;
  header.title = path ? "Open page" : "";
  header.disabled = !path;
  header.dataset.hoverCardClose = "";
  header.addEventListener("click", () => {
    if (path) void editorApi.openLinkedPage(path);
  });
  content.append(header);

  const scroller = document.createElement("div");
  scroller.className = "wr-link-preview-body";
  content.append(scroller);

  let innerView: EditorView | null = null;
  if (!path) {
    scroller.append(note("No page yet. Click the link to create it."));
  } else if (body === null) {
    scroller.append(note("Could not read this page."));
  } else if (!body.trim()) {
    scroller.append(note("This page is empty."));
  } else {
    const host = document.createElement("div");
    host.dataset.inlineEditor = "";
    scroller.append(host);
    innerView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: body,
        extensions: previewExtensions(path, () => innerView === null),
      }),
    });
  }
  return {
    element: content,
    label: `Preview of ${title}`,
    destroy: () => {
      const view = innerView;
      innerView = null;
      view?.destroy();
    },
  };
}

export function wikiLinkPreview(getFilePath: () => string): Extension {
  return hoverCard({
    selector: ".cm-wiki-link",
    width: CARD_WIDTH,
    maxHeight: CARD_MAX_HEIGHT,
    build: (link, view, isStale) => buildPreview(link, view, isStale, getFilePath),
  });
}
