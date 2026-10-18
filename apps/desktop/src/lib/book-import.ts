import { bookPageNames, withBookProperties } from "./apple-books";
import { forgetBook, type LibraryBook } from "./book-library";
import {
  authorFromFileName,
  authorOf,
  bookFileOf,
  cleanBookTitle,
  newBookNote,
  sameAuthor,
} from "./book-highlights";
import { readBookAuthor, readPdfClues } from "@/components/book-reader/book-meta";
import { resolveDailyNoteFile } from "./daily-note";
import { pdfKind, withLibraryType } from "./library-add";
import { getFileExtension, getFileName, getFileStem, getParentDir } from "./paths";
import * as tauri from "./tauri";
import { firstBookLinkTarget } from "./wiki-links";
import { findWikiPage, newPagePath, safePageName } from "./wiki-pages";
import { resolveEmbedPath } from "@/components/editor-area/wiki-embed-resolver";
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

/**
 * Show the book and its page next to each other. With the page already open,
 * the book goes in the column right after it and comes into view; otherwise
 * the book opens and its page follows to its right. An open book is just
 * brought into view.
 */
export async function openBook(bookPath: string, notePath: string | null): Promise<void> {
  const store = useEditorStore.getState();
  const isBook = (tab: Tab) => tab.location.kind === "book" && tab.location.path === bookPath;
  const existing = store.tabs.find(isBook);
  if (existing) {
    store.setActiveTab(existing.id);
    return;
  }
  const noteTab = notePath
    ? store.tabs.find((tab) => tab.location.kind === "file" && tab.location.path === notePath)
    : undefined;
  store.openOrFocus(isBook, () => ({
    id: `book-tab-${++tabSequence}`,
    location: { kind: "book", path: bookPath, note: notePath ?? undefined },
    back: [],
    forward: [],
  }));
  if (noteTab) {
    const { tabs, moveTab, setActiveTab } = useEditorStore.getState();
    const bookIndex = tabs.findIndex(isBook);
    const noteIndex = tabs.findIndex((tab) => tab.id === noteTab.id);
    if (bookIndex === -1 || noteIndex === -1) return;
    const bookTab = tabs[bookIndex]!;
    // `moveTab` takes the final index: right after the page either way.
    moveTab(bookTab.id, bookIndex < noteIndex ? noteIndex : noteIndex + 1);
    setActiveTab(bookTab.id);
    return;
  }
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
      if (!found) continue;
      // An existing page for the book is its page, unless it reads another file.
      const file = bookFileOf((await readPageParts(found)).frontmatter);
      if (file === null || file === getFileName(bookPath)) return found;
    }
  }
  await tauri.createFile(sibling);
  await tauri.writeFile(sibling, newBookNote(getFileName(bookPath)));
  return sibling;
}

export interface ImportBookOptions {
  /** The kind the user chose; left out, a new PDF's page is typed by its first
   *  pages (`settlePdfType`). */
  type?: "book" | "paper";
  /** Open the book and its page once imported (default true). */
  open?: boolean;
}

/** Copy `sourcePath` beside its book page (found, or made in the Book pages
 *  folder) and open both unless `open` is false. Returns the page's path, or
 *  null when nothing was imported (the reason is shown). */
export async function importBook(
  sourcePath: string,
  { type, open = true }: ImportBookOptions = {},
): Promise<string | null> {
  const root = useWorkspaceStore.getState().root;
  if (!root) return null;
  const folder = useSettingsStore.getState().getSetting("apple-books.folder") ?? "";
  const anchor = resolveDailyNoteFile(root, folder, "_.md");
  if (!anchor.ok) {
    showEditorNotice(
      `Book pages folder "${folder}" is outside the workspace. Pick a folder inside it in Settings → Apple Books, or clear it.`,
    );
    return null;
  }

  const names = bookPageNames(safePageName(cleanBookTitle(getFileStem(sourcePath))));
  if (!names.length) {
    showEditorNotice("That book's file name has no usable title.");
    return null;
  }
  const author = (await readBookAuthor(sourcePath)) ?? authorFromFileName(getFileStem(sourcePath));
  const shortName = names[names.length - 1]!;
  // A page by another author's name is someone else's book: that book gets
  // its own page, named with its author.
  const authoredName = author ? safePageName(`${shortName} (${author})`) : null;

  // An existing page with the book's name is its page, unless both name an
  // author and they differ.
  let notePath: string | null = null;
  let nameTaken = false;
  for (const name of [...names, ...(authoredName ? [authoredName] : [])]) {
    const found = await findWikiPage(name, root, anchor.path, tauriWikiPageDeps);
    if (!found) continue;
    const pageAuthor = authorOf((await readPageParts(found)).frontmatter);
    if (!author || !pageAuthor || sameAuthor(author, pageAuthor)) {
      notePath = found;
      break;
    }
    nameTaken = true;
  }
  const isNew = !notePath;
  const name = nameTaken && authoredName ? authoredName : shortName;
  notePath ??= newPagePath(name, root, anchor.path);

  // The page already has this book beside it (dropped again): open that copy.
  if (!isNew) {
    const existing = bookFileOf((await readPageParts(notePath)).frontmatter);
    const existingPath = existing ? `${getParentDir(notePath)}/${existing}` : null;
    if (existingPath && (await tauri.fileExists(existingPath))) {
      await editPage(notePath, (page) => ({
        frontmatter: withBookProperties(page.frontmatter, { author }),
        body: page.body,
      }));
      if (open) await openBook(existingPath, notePath);
      return notePath;
    }
  }

  const bookPath = await tauri.importBook(
    sourcePath,
    getParentDir(notePath),
    getFileStem(notePath),
  );
  const bookFile = getFileName(bookPath);
  if (isNew) {
    await tauri.createFile(notePath);
    await tauri.writeFile(notePath, newBookNote(bookFile, author));
    if (type === "paper") await retypeAsPaper(notePath);
    else if (!type && getFileExtension(bookPath).toLowerCase() === "pdf") {
      await settlePdfType(bookPath, notePath);
    }
  } else {
    await editPage(notePath, (page) => ({
      frontmatter: withBookProperties(page.frontmatter, { book: bookFile, author }),
      body: page.body,
    }));
  }
  if (open) await openBook(bookPath, notePath);
  return notePath;
}

function retypeAsPaper(notePath: string): Promise<void> {
  return editPage(notePath, (page) => ({
    frontmatter: withLibraryType(page.frontmatter, "Paper"),
    body: page.body,
  }));
}

/** Retype the new page of a PDF that reads as a paper; one nothing decides
 *  stays a book, the commoner kind, with one click to change it. */
async function settlePdfType(bookPath: string, notePath: string): Promise<void> {
  const clues = await readPdfClues(bookPath);
  const kind = clues ? pdfKind(clues) : null;
  const toPaper = () => retypeAsPaper(notePath);
  if (kind === "paper") {
    await toPaper();
  } else if (kind === null) {
    showEditorNotice(`Added ${getFileStem(notePath)} as a book`, {
      label: "Change to paper",
      run: () => {
        void toPaper().catch((error: unknown) => {
          console.error(`[book] Couldn't make ${notePath} a paper:`, error);
          showEditorNotice("Couldn't change it to a paper.");
        });
      },
    });
  }
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

/** A Library card's book page, already open: its book (`file`, the page's
 *  `Book` value) joins it when it is beside the page; a page without one just
 *  stays open on its own, with no notice. */
export async function openBookBesideOpenPage(notePath: string, file: string): Promise<void> {
  const bookPath = `${getParentDir(notePath)}/${file}`;
  if (isBookFile(bookPath) && (await tauri.fileExists(bookPath))) {
    await openBook(bookPath, notePath);
  }
}

/** A Library card's page with no `Book` value, already open: the first PDF or
 *  EPUB its body links to (`![[paper.pdf]]`, found as an embed is) joins it in
 *  the reader; with none, or one that isn't there, the page stays on its own. */
export async function openLinkedBookBesideOpenPage(notePath: string): Promise<void> {
  const target = firstBookLinkTarget((await tauri.readFile(notePath)).content);
  if (!target) return;
  const root = useWorkspaceStore.getState().root;
  const bookPath = await resolveEmbedPath(target, root, notePath);
  if (bookPath) await openBook(bookPath, notePath);
}

/** A book picked from search: open it beside its page, or, when its file is
 *  gone, say so and drop it from the library. */
export async function openLibraryBook(entry: LibraryBook): Promise<void> {
  if (!(await tauri.fileExists(entry.book))) {
    const root = useWorkspaceStore.getState().root;
    if (root) await forgetBook(root, entry.book);
    showEditorNotice(`"${getFileName(entry.book)}" is no longer in the workspace.`);
    return;
  }
  const note = entry.note && (await tauri.fileExists(entry.note)) ? entry.note : null;
  await openBook(entry.book, note ?? (await resolveBookNote(entry.book, null)));
}
