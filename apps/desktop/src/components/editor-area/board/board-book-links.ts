/**
 * Book highlights on a board (SPECs/board-lark-parity-spec.md#edit-in-the-note).
 *
 * A highlight made in a book beside a board open over a page lands on it as a
 * rectangle whose `ln` is `Page#^bk-…`: the book's page and the highlight's
 * block id there. Portable like any `[[link]]` — no absolute paths in the
 * file — and resolved from the board's own note when used.
 *
 * - Clicking the rectangle scrolls the book to the passage (opening it first
 *   when it is closed).
 * - The rectangle keeps its highlight: only deleting the last rectangle that
 *   links to it removes the highlight from the page (and so from the book).
 *   Editing the text does not; the link lives beside it. An undo that brings
 *   the rectangle back brings the highlight back too.
 */

import { getWorkspaceRoot } from "@/hooks/workspace-api";
import {
  type BookLocation,
  bookHighlightId,
  parseBookHighlightId,
  withBookHighlight,
  withoutBookHighlight,
} from "@/lib/book-highlights";
import { isBookOpenFor, jumpToHighlight, requestJump } from "@/lib/book-readers";
import { getFileStem } from "@/lib/paths";
import { findWikiPage } from "@/lib/wiki-pages";
import { showEditorNotice } from "../editor-notice-store";
import { editPage } from "../linked-block-sync";
import { tauriWikiPageDeps } from "../wiki-pages-extension";
import { type BoardScene, isShape, textOf } from "./board-model";

/** The `ln` of a highlight's rectangle. */
export function bookLinkTarget(notePath: string, location: BookLocation): string {
  return `${getFileStem(notePath)}#^${bookHighlightId(location)}`;
}

/** The page name and highlight id in a book link, or null for any other link. */
export function parseBookLink(inner: string): { page: string; id: string } | null {
  const at = inner.lastIndexOf("#^");
  if (at <= 0) return null;
  const id = inner.slice(at + 2).split("|")[0]!;
  return parseBookHighlightId(id) ? { page: inner.slice(0, at), id } : null;
}

async function pagePath(page: string, fromPath: string | null): Promise<string | null> {
  const root = getWorkspaceRoot();
  if (!root) return null;
  return findWikiPage(page, root, fromPath, tauriWikiPageDeps);
}

/** Shows the passage in its book: scrolls it there, opening the book beside
 *  its page first when it is closed. */
export async function openBookLink(inner: string, fromPath: string | null): Promise<void> {
  const link = parseBookLink(inner);
  const path = link && (await pagePath(link.page, fromPath));
  if (!link || !path) {
    showEditorNotice(`Couldn't find the book page "${link?.page ?? inner}".`);
    return;
  }
  if (isBookOpenFor(path)) {
    jumpToHighlight(path, link.id);
    return;
  }
  requestJump(path, link.id);
  // Lazily: the import flow pulls in stores the board shouldn't load up front.
  const { openBookOfPage } = await import("@/lib/book-import");
  await openBookOfPage(path);
}

/** Highlight links on the board, by the rectangle carrying them. */
function bookLinksOf(scene: BoardScene): Map<string, { ln: string; text: string }> {
  const out = new Map<string, { ln: string; text: string }>();
  for (const el of scene.els) {
    if (isShape(el) && el.ln && parseBookLink(el.ln)) {
      out.set(el.id, { ln: el.ln, text: textOf(el) });
    }
  }
  return out;
}

/**
 * Keeps a board session's highlights in step with its rectangles. Call
 * `sync` with each committed scene: a highlight whose last rectangle went is
 * removed from its page, and one whose rectangle came back (undo) is put back.
 */
export function bookLinkSync(start: BoardScene, fromPath: string | null) {
  let known = bookLinksOf(start);

  const edit = (ln: string, change: (body: string, id: string) => string): void => {
    const link = parseBookLink(ln);
    if (!link) return;
    void pagePath(link.page, fromPath)
      .then((path) => {
        if (!path) throw new Error(`no page "${link.page}"`);
        return editPage(path, (page) => ({
          frontmatter: page.frontmatter,
          body: change(page.body, link.id),
        }));
      })
      .catch((error: unknown) => console.error(`[board] could not update highlight ${ln}`, error));
  };

  return {
    sync(scene: BoardScene): void {
      const now = bookLinksOf(scene);
      const linkedNow = new Set([...now.values()].map((v) => v.ln));
      const linkedBefore = new Set([...known.values()].map((v) => v.ln));
      for (const [id, { ln }] of known) {
        if (!now.has(id) && !linkedNow.has(ln)) edit(ln, withoutBookHighlight);
      }
      for (const [id, { ln, text }] of now) {
        if (known.has(id) || linkedBefore.has(ln)) continue;
        // Back from an undo (a new one from the book is already on its page,
        // and adding it again is a no-op).
        edit(ln, (body, hid) => {
          const location = parseBookHighlightId(hid);
          return location ? withBookHighlight(body, text, location) : body;
        });
      }
      known = now;
    },
  };
}
