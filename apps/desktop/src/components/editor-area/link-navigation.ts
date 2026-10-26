import { EditorView, keymap } from "@codemirror/view";
import { type Extension, Prec } from "@codemirror/state";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import * as editorApi from "@/hooks/editor-api";
import { getWorkspaceRoot } from "@/hooks/workspace-api";
import { buildSlugIndex, parseDocumentHeadings } from "@/hooks/use-document-headings";
import type { DocumentHeading } from "@/hooks/use-document-headings";
import { resolveLinkTarget } from "@/lib/paths";
import { setPendingAnchor } from "@/lib/pending-anchor";
import { linkUrlAt, rawUrlAt } from "@/lib/prosemark-core/links";
import { findWikiLinkAt } from "@/lib/wiki-links";
import * as tauri from "@/lib/tauri";
import { findOuterScroller, scrollPosToSafeTop } from "./editor-scroll";
import { showEditorNotice } from "./editor-notice-store";
import { followWikiLink } from "./wiki-pages-extension";

export function findHeadingBySlug(content: string, slug: string): DocumentHeading | undefined {
  return buildSlugIndex(parseDocumentHeadings(content, { maxDepth: 6, slugDepth: 6 })).get(slug);
}

function scrollSameDocAnchor(view: EditorView, filePath: string, anchor: string) {
  const file = editorApi.getOpenFile(filePath);
  const content = file?.content ?? view.state.doc.toString();
  const heading = findHeadingBySlug(content, anchor);
  if (!heading) {
    showEditorNotice(`Heading "#${anchor}" not found in this document`);
    return;
  }
  const scroller = findOuterScroller(view.dom);
  if (!scroller) return;
  scrollPosToSafeTop(view, scroller, heading.pos, "smooth");
}

/** Navigate to `href` as written in the document: same-document anchors
 *  scroll, workspace files open in the tab (with a pending anchor), external
 *  URLs and other paths hand off to the OS. */
export async function followLink(href: string | null, view: EditorView, filePath: string) {
  if (!href) return;

  // A transcript's time link plays its take from that moment, in the player
  // in this note (SPECs/talk-notes-spec.md#the-note-after-a-stop).
  const time = recordingTime(href);
  if (time) {
    const { playRecordingAt } = await import("./audio-embed-widget");
    if (playRecordingAt(time.path, time.seconds)) return;
  }

  const target = await resolveLinkTarget(href, filePath, getWorkspaceRoot(), (path) =>
    tauri.fileExists(path),
  );
  if (!target) return;

  if (target.kind === "same-doc-anchor") {
    scrollSameDocAnchor(view, filePath, target.anchor);
    return;
  }

  if (target.kind === "internal") {
    if (target.anchor && target.path === filePath) {
      scrollSameDocAnchor(view, filePath, target.anchor);
      return;
    }
    // A page already open in a tab keeps its editor, so a pending anchor
    // would never be consumed; it only applies to a page about to mount.
    if (target.anchor && !editorApi.isFileOpenInTab(target.path)) {
      setPendingAnchor(target.path, target.anchor);
    }
    await editorApi.openLinkedPage(target.path);
    return;
  }

  if (target.kind === "external-url") {
    await openUrl(target.url);
    return;
  }

  // A book opens in the reader, not the system viewer. No page hint: the
  // linking page is not necessarily the book's page (SPECs/book-reader-spec.md).
  if (/\.(pdf|epub)$/i.test(target.path)) {
    const { openBook } = await import("@/lib/book-import");
    await openBook(target.path, null);
    return;
  }

  await openPath(target.path);
}

/** `Recordings/x.m4a#t=75` → the take and the second to play it from; null for any other link. */
export function recordingTime(href: string): { path: string; seconds: number } | null {
  const m = /^<?([^<>#]+\.(?:m4a|mp3|wav|ogg|oga|aac|flac|webm|mp4))#t=(\d+(?:\.\d+)?)>?$/i.exec(
    href.trim(),
  );
  if (!m) return null;
  let path = m[1]!;
  try {
    path = decodeURI(path);
  } catch {
    // Not percent-encoded: keep it as written.
  }
  return { path, seconds: Number(m[2]) };
}

/** Link href under a document position, whether rendered or a bare URL. */
export function linkHrefAtPos(view: EditorView, pos: number): string | null {
  return linkUrlAt(view.state, pos) ?? rawUrlAt(view.state, pos) ?? null;
}

/** Resolve the link href under a mouse event, or null if it isn't a link.
 *  Shared by the mousedown (claim the press) and click (navigate) handlers. */
function linkHrefAt(event: MouseEvent, view: EditorView): string | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;

  const htmlAnchor = target.closest(".cm-html-block-widget a");
  if (htmlAnchor instanceof HTMLAnchorElement) {
    return htmlAnchor.getAttribute("href");
  }

  const renderedLink = target.closest(".cm-rendered-link");
  const isRenderedLink = renderedLink !== null;
  const isRawUrl = target.closest(".cm-url") !== null;
  if (!isRenderedLink && !isRawUrl) return null;

  if (renderedLink instanceof HTMLElement && renderedLink.dataset.href) {
    return renderedLink.dataset.href;
  }
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return null;
  return (isRenderedLink ? linkUrlAt(view.state, pos) : rawUrlAt(view.state, pos)) ?? null;
}

/** Follow the wiki or markdown link under the caret as a click would, or
 *  return false when the caret isn't on one. */
function followLinkAtCaret(
  view: EditorView,
  getFilePath: () => string,
  isDisposed: () => boolean,
): boolean {
  const pos = view.state.selection.main.head;
  const wiki = findWikiLinkAt(view.state.doc, pos);
  if (wiki && !wiki.embed) {
    void followWikiLink(wiki.inner, getFilePath() || null)
      .then((path) => {
        if (path && !isDisposed()) void editorApi.openLinkedPage(path);
      })
      .catch((error) => {
        if (!isDisposed()) console.error("[editor] Failed to follow wiki link:", error);
      });
    return true;
  }
  const href = linkHrefAtPos(view, pos);
  if (href === null) return false;
  void followLink(href, view, getFilePath()).catch((error) => {
    if (!isDisposed()) console.error("[editor] Failed to open link:", error);
  });
  return true;
}

export function linkNavigationExtension(
  getFilePath: () => string,
  isDisposed: () => boolean,
): Extension {
  const follow = (view: EditorView) => followLinkAtCaret(view, getFilePath, isDisposed);
  return [
    // Obsidian's keys for the link under the caret: ⌥Enter follows it, and
    // ⌘Enter (open in a new tab there) does the same, since following a link
    // already opens it beside. Off a link both fall through: ⌘Enter keeps its
    // own meaning (SPECs/obsidian-shortcuts-spec.md).
    Prec.highest(
      keymap.of([
        { key: "Alt-Enter", run: follow },
        { key: "Mod-Enter", run: follow },
      ]),
    ),
    linkClickHandlers(getFilePath, isDisposed),
  ];
}

function linkClickHandlers(getFilePath: () => string, isDisposed: () => boolean): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      // Claim the press on mousedown so CodeMirror doesn't move the caret
      // into the link (which would unfold a rendered link), but defer the
      // actual navigation to the click (mouseup) so it follows on release.
      mousedown(event, view) {
        if (linkHrefAt(event, view) === null) return false;
        event.preventDefault();
        event.stopPropagation();
        return true;
      },
      click(event, view) {
        const href = linkHrefAt(event, view);
        if (href === null) return false;
        event.preventDefault();
        event.stopPropagation();
        void followLink(href, view, getFilePath()).catch((error) => {
          if (!isDisposed()) console.error("[editor] Failed to open link:", error);
        });
        return true;
      },
    }),
  );
}
