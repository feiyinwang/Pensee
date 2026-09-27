import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type EditorState, type Extension, Prec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import * as tauri from "@/lib/tauri";
import { getFileStem, getParentDir } from "@/lib/paths";
import { findWikiLinkAt } from "@/lib/wiki-links";
import {
  type WikiPageDeps,
  ensureWikiPage,
  freePagePath,
  newPageContent,
  newPagePath,
  pageFromSelection,
} from "@/lib/wiki-pages";
import { getWorkspaceRoot } from "@/hooks/workspace-api";
import { showEditorNotice } from "./editor-notice-store";

// Pages behind `[[wiki links]]`, from the editor's side:
//
// - Finishing a `[[Name]]` creates `Name.md` when no page matches, so the link
//   is live the moment it is written. "Finished" means the caret has left the
//   token (or the editor lost focus while inside it): creating on every
//   keystroke would leave a trail of `N.md`, `Na.md`, `Nam.md` behind.
// - Clicking a link whose page does not exist creates it and opens it
//   (`openWikiPage`, used by `wiki-link-extension.ts`).
// - "Move selection to new page" (Cmd+Alt+N, and the editor context menu)
//   moves the selected text into a new page titled after its first line and
//   leaves a `[[link]]` to it in its place.

export const tauriWikiPageDeps: WikiPageDeps = {
  fuzzySearch: tauri.fuzzySearch,
  fileExists: tauri.fileExists,
  createFile: tauri.createFile,
  writeFile: tauri.writeFile,
};

export const MOVE_SELECTION_TO_PAGE_CHORD = "Mod-Alt-n";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolve `inner` to its page, creating the page when there is none. */
export function openWikiPage(inner: string, currentFilePath: string | null) {
  const root = getWorkspaceRoot();
  if (!root) return Promise.resolve(null);
  return ensureWikiPage(inner, root, currentFilePath, tauriWikiPageDeps);
}

const CODE_NODES = new Set(["FencedCode", "InlineCode", "CodeBlock", "CodeText"]);

function inCode(state: EditorState, pos: number): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (CODE_NODES.has(node.name)) return true;
  }
  return false;
}

interface CaretLink {
  from: number;
  inner: string;
}

/** The plain `[[...]]` link the caret is in, if any. Embeds (`![[...]]`) point
 *  at attachments and are never turned into pages. */
function linkAtCaret(state: EditorState): CaretLink | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const match = findWikiLinkAt(state.doc, sel.head);
  if (!match || match.embed || inCode(state, match.from)) return null;
  return { from: match.from, inner: match.inner };
}

function autoCreateOnLeave(getFilePath: () => string, isDisposed: () => boolean): Extension {
  return ViewPlugin.fromClass(
    class {
      private editing: CaretLink | null;

      constructor(view: EditorView) {
        this.editing = linkAtCaret(view.state);
      }

      update(update: ViewUpdate) {
        const blurred = update.focusChanged && !update.view.hasFocus;
        if (!update.selectionSet && !update.docChanged && !blurred) return;
        const now = blurred ? null : linkAtCaret(update.state);
        const prev = this.editing;
        this.editing = now;
        if (!prev) return;
        // Same token, still being typed into: its start maps onto the new one.
        const prevFrom = update.changes.mapPos(prev.from, 1);
        if (now && now.from === prevFrom) return;
        // The caret left the token. Read what it says now; if it was deleted
        // on the way out, there is nothing to create.
        const left = findWikiLinkAt(update.state.doc, prevFrom);
        if (!left || left.from !== prevFrom || left.embed) return;
        const currentFile = getFilePath() || null;
        void openWikiPage(left.inner, currentFile).catch((error) => {
          if (!isDisposed()) showEditorNotice(`Could not create the page: ${errorText(error)}`);
        });
      }
    },
  );
}

/** Move the main selection into a new page titled after its first line, and
 *  put a link to that page where the selection was. */
export function moveSelectionToPage(
  view: EditorView,
  getFilePath: () => string,
  isDisposed: () => boolean,
): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  const text = view.state.sliceDoc(from, to);
  const page = pageFromSelection(text);
  if (!page) {
    showEditorNotice("The first selected line has no text to name the page after");
    return true;
  }
  const root = getWorkspaceRoot();
  if (!root) {
    showEditorNotice("Open a folder to create pages in");
    return true;
  }
  const dir = getParentDir(newPagePath(page.title, root, getFilePath() || null));

  void (async () => {
    try {
      const path = await freePagePath(dir, page.title, tauri.fileExists);
      const name = getFileStem(path);
      await tauri.createFile(path);
      await tauri.writeFile(path, newPageContent(name, page.body));
      if (isDisposed()) return;
      // The page exists now either way. Only swap the text for the link if
      // it is still exactly what was selected — never overwrite an edit made
      // while the file was being written.
      if (view.state.sliceDoc(from, to) !== text) {
        showEditorNotice(`Created "${name}", but the text changed meanwhile, so it was kept`);
        return;
      }
      const link = `[[${name}]]`;
      view.dispatch({
        changes: { from, to, insert: link },
        selection: { anchor: from + link.length },
        userEvent: "input",
        scrollIntoView: true,
      });
    } catch (error) {
      if (!isDisposed()) showEditorNotice(`Could not create the page: ${errorText(error)}`);
    }
  })();
  return true;
}

export function wikiPagesExtension(
  getFilePath: () => string,
  isDisposed: () => boolean,
): Extension {
  return [
    autoCreateOnLeave(getFilePath, isDisposed),
    Prec.high(
      keymap.of([
        {
          key: MOVE_SELECTION_TO_PAGE_CHORD,
          run: (view) => moveSelectionToPage(view, getFilePath, isDisposed),
        },
      ]),
    ),
  ];
}
