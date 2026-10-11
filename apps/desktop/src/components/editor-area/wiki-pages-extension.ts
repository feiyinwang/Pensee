import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type EditorState, type Extension, Prec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import * as tauri from "@/lib/tauri";
import { getFileStem } from "@/lib/paths";
import { serializeDocument } from "@/lib/frontmatter";
import { isSaveInFlight } from "@/lib/save";
import * as editorApi from "@/hooks/editor-api";
import { findWikiLinkAt, resolveWikiLink } from "@/lib/wiki-links";
import {
  type WikiPageDeps,
  appendPageBody,
  ensureWikiPage,
  findWikiPage,
  safePageName,
  textMovedToPage,
  newPageContent,
  newPagePath,
  pageFromSelection,
} from "@/lib/wiki-pages";
import { getWorkspaceRoot } from "@/hooks/workspace-api";
import { useSettingsStore } from "@/stores/settings-store";
import { useUIStore } from "@/stores/ui-store";
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
  dailyNoteFolder: () =>
    useSettingsStore.getState().getSetting("workspace.daily-note-folder") ?? "",
};

/** Shown in menus (via `chordToAccelerator`). Not bound through `keymap`: see
 *  `isMoveToPageKey`. */
export const MOVE_SELECTION_TO_PAGE_CHORD = "Mod-Alt-n";

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** Cmd+Alt+N (Ctrl+Alt+N elsewhere), matched on the physical key.
 *
 *  A `keymap` binding for `Mod-Alt-n` never fires on a Mac: Option+N is a dead
 *  key (it starts `ñ`), so the event's `key` is `"Dead"`, and CodeMirror only
 *  falls back to the key code when `key` is a single character. Option+digit
 *  yields a real character (`¡`), which is why the Cmd+Alt+1…6 heading keys
 *  work and this one did not. `event.code` names the key, not what it types,
 *  so it is also immune to the active input source (Pinyin included). */
export function isMoveToPageKey(event: KeyboardEvent): boolean {
  const mod = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return mod && event.altKey && !event.shiftKey && event.code === "KeyN";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolve `inner` to its page, creating the page when there is none. */
export function openWikiPage(inner: string, currentFilePath: string | null) {
  const root = getWorkspaceRoot();
  if (!root) return Promise.resolve(null);
  return ensureWikiPage(inner, root, currentFilePath, tauriWikiPageDeps);
}

/** The page a `[[link]]` points at, created when it does not exist yet — what
 *  clicking a link does in the editor and on a board. Null without a workspace. */
export async function followWikiLink(
  inner: string,
  currentFilePath: string | null,
): Promise<string | null> {
  const root = getWorkspaceRoot();
  if (!root) return null;
  const result = await resolveWikiLink(
    inner,
    root,
    tauri.fuzzySearch,
    tauri.fileExists,
    currentFilePath,
  );
  return result.kind === "internal" ? result.path : openWikiPage(inner, currentFilePath);
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

const SAVE_IDLE_POLL_MS = 20;
const SAVE_IDLE_TIMEOUT_MS = 2000;

/** Resolve once no autosave of `path` is being written, so an append cannot be
 *  overwritten by a save that started from the older text. */
async function saveIdle(path: string): Promise<void> {
  const deadline = Date.now() + SAVE_IDLE_TIMEOUT_MS;
  while (isSaveInFlight(path)) {
    if (Date.now() > deadline) throw new Error(`"${getFileStem(path)}" is still saving`);
    await new Promise((resolve) => setTimeout(resolve, SAVE_IDLE_POLL_MS));
  }
}

/** Add `body` to the end of an existing page. When that page is open in a
 *  tab, the tab's text is the base — it may hold edits not yet on disk — and
 *  the tab is reloaded with the result, since a write of our own is not
 *  reported back by the file watcher. */
async function appendToPage(path: string, body: string): Promise<void> {
  if (!body.trim()) return;
  await saveIdle(path);
  const open = editorApi.getOpenFile(path);
  const base =
    open && !open.isLoading
      ? serializeDocument(open.frontmatter, open.content)
      : (await tauri.readFile(path)).content;
  const next = appendPageBody(base, body);
  await tauri.writeFile(path, next);
  if (editorApi.getOpenFile(path)) editorApi.reloadFromDisk(path, next);
}

/** Where a selection is moving to, picked in the command palette's
 *  `move-to-page` mode: an existing page, or a new page by name. */
export type MoveTarget = { kind: "existing"; path: string } | { kind: "new"; name: string };

interface PendingMove {
  view: EditorView;
  from: number;
  to: number;
  text: string;
  currentFile: string | null;
  isDisposed: () => boolean;
}

/** The selection waiting for the palette to say where it goes. One at a time:
 *  the palette is modal, and a second Cmd+Alt+N replaces the first. */
let pendingMove: PendingMove | null = null;

/** Open the page picker for the main selection, pre-filled with the name its
 *  first line suggests. The move itself happens in `completeMoveToPage`. */
export function moveSelectionToPage(
  view: EditorView,
  getFilePath: () => string,
  isDisposed: () => boolean,
): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  if (!getWorkspaceRoot()) {
    showEditorNotice("Open a folder to create pages in");
    return true;
  }
  const text = view.state.sliceDoc(from, to);
  pendingMove = { view, from, to, text, currentFile: getFilePath() || null, isDisposed };
  useUIStore.getState().openCommandPalette("move-to-page", pageFromSelection(text)?.title ?? "");
  return true;
}

/** The page picker closed without a choice. */
export function cancelMoveToPage() {
  const move = pendingMove;
  pendingMove = null;
  if (move && !move.isDisposed()) move.view.focus();
}

/** The file the pending move comes from, so the picker can leave it out. */
export function pendingMoveSource(): string | null {
  return pendingMove?.currentFile ?? null;
}

/** Move the pending selection to `target` and leave a link to it behind. An
 *  existing page gets the text added at its end; a new page is created with
 *  the name as its title. See `textMovedToPage` for which lines move. */
export function completeMoveToPage(target: MoveTarget) {
  const move = pendingMove;
  pendingMove = null;
  if (!move || move.isDisposed()) return;
  const { view, from, to, text, currentFile, isDisposed } = move;
  const root = getWorkspaceRoot();
  if (!root) return;

  void (async () => {
    try {
      let path: string;
      if (target.kind === "existing") {
        path = target.path;
        if (path === currentFile) throw new Error("that is the page the text is on");
        await appendToPage(path, textMovedToPage(text, getFileStem(path)));
      } else {
        const name = safePageName(target.name);
        if (!name) throw new Error("the page needs a name");
        // Picked "new", but the page may exist after all (created meanwhile,
        // or not yet in the search index): add to it rather than fail.
        const existing = await findWikiPage(name, root, currentFile, tauriWikiPageDeps);
        path =
          existing ?? newPagePath(name, root, currentFile, tauriWikiPageDeps.dailyNoteFolder?.());
        if (path === currentFile) throw new Error("that is the page the text is on");
        const moved = textMovedToPage(text, name);
        if (existing) {
          await appendToPage(path, moved);
        } else {
          await tauri.createFile(path);
          await tauri.writeFile(path, newPageContent(name, moved));
        }
      }
      if (isDisposed()) return;
      const name = getFileStem(path);
      // The page has the text now either way. Only swap the selection for the
      // link if it is still exactly what was selected — never overwrite an
      // edit made while the file was being written.
      if (view.state.sliceDoc(from, to) !== text) {
        showEditorNotice(`Added to "${name}", but the text here changed meanwhile, so it was kept`);
        return;
      }
      const link = `[[${name}]]`;
      view.dispatch({
        changes: { from, to, insert: link },
        selection: { anchor: from + link.length },
        userEvent: "input",
        scrollIntoView: true,
      });
      view.focus();
      showEditorNotice(`Moved to "${name}"`);
    } catch (error) {
      if (!isDisposed()) showEditorNotice(`Could not move the text: ${errorText(error)}`);
    }
  })();
}

export function wikiPagesExtension(
  getFilePath: () => string,
  isDisposed: () => boolean,
): Extension {
  return [
    autoCreateOnLeave(getFilePath, isDisposed),
    Prec.high(
      EditorView.domEventHandlers({
        keydown(event, view) {
          if (!isMoveToPageKey(event)) return false;
          event.preventDefault();
          return moveSelectionToPage(view, getFilePath, isDisposed);
        },
      }),
    ),
  ];
}
