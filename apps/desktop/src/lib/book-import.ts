import { bookPageNames, withBookProperties } from "./apple-books";
import { bookFileOf, cleanBookTitle, newBookNote } from "./book-highlights";
import { resolveDailyNoteFile } from "./daily-note";
import { getFileName, getFileStem, getParentDir } from "./paths";
import * as tauri from "./tauri";
import { findWikiPage, newPagePath, safePageName } from "./wiki-pages";
import { editPage, readPageParts } from "@/components/editor-area/linked-block-sync";
import { showEditorNotice } from "@/components/editor-area/editor-notice-store";
import { tauriWikiPageDeps } from "@/components/editor-area/wiki-pages-extension";
import { useEditorStore, type Tab } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

// Bringing a PDF/EPUB into the workspace and opening it beside its book page,
// per SPECs/book-reader-spec.md.

export const BOOK_EXTENSIONS = ["pdf", "epub"];

export function isBookFile(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return BOOK_EXTENSIONS.includes(ext);
}

let tabSequence = 0;

/** Show the book in a tab, and its page in a column to the right of it. */
export async function openBook(bookPath: string, notePath: string | null): Promise<void> {
  const store = useEditorStore.getState();
  store.openOrFocus(
    (tab) => tab.location.kind === "book" && tab.location.path === bookPath,
    (): Tab => ({
      id: `book-tab-${++tabSequence}`,
      location: { kind: "book", path: bookPath, note: notePath ?? undefined },
      back: [],
      forward: [],
    }),
  );
  if (notePath) await useEditorStore.getState().openFileBeside(notePath);
}

/**
 * The book page for `bookPath`: `hint` (the page it was opened with) while it
 * exists, else the page beside it with the same name, else a page found by
 * the book's name. With none, a new page is made beside the book, so every
 * open book has a page to hold its highlights.
 */
export async function resolveBookNote(bookPath: string, hint: string | null): Promise<string> {
  if (hint && (await tauri.fileExists(hint))) return hint;
  const sibling = `${getParentDir(bookPath)}/${getFileStem(bookPath)}.md`;
  if (await tauri.fileExists(sibling)) return sibling;
  const root = useWorkspaceStore.getState().root;
  if (root) {
    for (const name of bookPageNames(getFileStem(bookPath))) {
      const found = await findWikiPage(name, root, bookPath, tauriWikiPageDeps);
      if (found && bookFileOf((await readPageParts(found)).frontmatter) === getFileName(bookPath))
        return found;
    }
  }
  await tauri.createFile(sibling);
  await tauri.writeFile(sibling, newBookNote(getFileName(bookPath)));
  return sibling;
}

/** Copy `sourcePath` beside its book page (found, or made in the Book pages
 *  folder) and open both. */
export async function importBook(sourcePath: string): Promise<void> {
  const root = useWorkspaceStore.getState().root;
  if (!root) return;
  const folder = useSettingsStore.getState().getSetting("apple-books.folder") ?? "";
  const anchor = resolveDailyNoteFile(root, folder, "_.md");
  if (!anchor.ok) {
    showEditorNotice(
      `Book pages folder "${folder}" is outside the workspace. Pick a folder inside it in Settings → Apple Books, or clear it.`,
    );
    return;
  }

  const names = bookPageNames(safePageName(cleanBookTitle(getFileStem(sourcePath))));
  if (!names.length) {
    showEditorNotice("That book's file name has no usable title.");
    return;
  }
  let notePath: string | null = null;
  for (const name of names) {
    notePath = await findWikiPage(name, root, anchor.path, tauriWikiPageDeps);
    if (notePath) break;
  }
  const isNew = !notePath;
  const name = names[names.length - 1]!;
  notePath ??= newPagePath(name, root, anchor.path);

  const bookPath = await tauri.importBook(
    sourcePath,
    getParentDir(notePath),
    getFileStem(notePath),
  );
  const bookFile = getFileName(bookPath);
  if (isNew) {
    await tauri.createFile(notePath);
    await tauri.writeFile(notePath, newBookNote(bookFile));
  } else {
    await editPage(notePath, (page) => ({
      frontmatter: withBookProperties(page.frontmatter, { book: bookFile }),
      body: page.body,
    }));
  }
  await openBook(bookPath, notePath);
}

export async function importBooks(paths: string[]): Promise<void> {
  for (const path of paths.filter(isBookFile)) {
    try {
      await importBook(path);
    } catch (error) {
      console.error(`[book] Couldn't import ${path}:`, error);
      showEditorNotice(
        `Couldn't import ${getFileName(path)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** The palette's Import Book… */
export async function pickAndImportBook(): Promise<void> {
  const path = await tauri.pickFile({ name: "Books", extensions: BOOK_EXTENSIONS });
  if (path) await importBooks([path]);
}

/** Open the book of page `notePath` (its `Book` file) beside it. */
export async function openBookOfPage(notePath: string): Promise<void> {
  const file = bookFileOf((await readPageParts(notePath)).frontmatter);
  if (!file) {
    showEditorNotice("This page has no Book file. Bring one in with Import Book….");
    return;
  }
  const bookPath = `${getParentDir(notePath)}/${file}`;
  if (!(await tauri.fileExists(bookPath))) {
    showEditorNotice(`The book file "${file}" isn't next to this page.`);
    return;
  }
  await openBook(bookPath, notePath);
}
