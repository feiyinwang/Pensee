import { createRootNote } from "@/hooks/use-spaces";
import { youtubeVideoId } from "@/lib/covers";
import {
  cleanPageTitle,
  fallbackLinkTitle,
  libraryNoteContent,
  libraryNoteType,
  type LibraryKind,
  type LibraryLink,
} from "@/lib/library-add";
import { spaceFileStem } from "@/lib/spaces";
import * as tauri from "@/lib/tauri";
import { safePageName } from "@/lib/wiki-pages";
import {
  dismissEditorNotice,
  showEditorNotice,
} from "@/components/editor-area/editor-notice-store";
import { bringInTranscript } from "@/components/editor-area/video-transcript";
import { useEditorStore } from "@/stores/editor-store";
import { useUIStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

// Adding a Library note from the palette (SPECs/add-to-library-spec.md). The
// palette rows never touch the network; the page's title is read only once a
// row is picked, and the note is named by it.

// A page slower than this gets a note named from its link instead.
const TITLE_TIMEOUT_MS = 5000;

/** Open the palette's add mode, with `kind` (a Library tab's) listed first. */
export function openLibraryAdd(kind: LibraryKind | null = null): void {
  useUIStore.getState().openLibraryAdd(kind);
}

async function linkTitle(link: LibraryLink): Promise<string | null> {
  let timer: number | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = window.setTimeout(() => resolve(null), TITLE_TIMEOUT_MS);
  });
  try {
    const preview = await Promise.race([tauri.fetchLinkPreview(link.url), timeout]);
    return preview?.title ? cleanPageTitle(preview.title, preview.site_name) : null;
  } catch (error) {
    // Offline or a page that refuses: the note is still made, named by its link.
    console.warn(`[library] Couldn't read the title of ${link.url}:`, error);
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Write a root note named `name` (or `name 2`, `name 3`… when taken), open
 *  it, and return its path. */
async function createAndOpen(name: string, content: string): Promise<string> {
  const root = useWorkspaceStore.getState().root;
  if (!root) throw new Error("Open a folder first");
  const base = safePageName(name);
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base} ${n}`;
    const stem = spaceFileStem(candidate);
    if (!stem) throw new Error("That has no usable name");
    if (await tauri.fileExists(`${root}/${stem}.md`)) continue;
    const { path } = await createRootNote(candidate, () => content);
    await useEditorStore.getState().openFile(path);
    return path;
  }
  throw new Error(`Too many notes are named "${base}"`);
}

function reportFailure(error: unknown): void {
  console.error("[library] Couldn't add to Library:", error);
  showEditorNotice(
    `Couldn't add to Library: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/** A note of `kind` for `link`, named by the page's title. */
export async function addLinkToLibrary(link: LibraryLink, kind: LibraryKind): Promise<void> {
  try {
    showEditorNotice(`Adding ${link.host}…`);
    const title = (await linkTitle(link)) || fallbackLinkTitle(link);
    const path = await createAndOpen(
      title,
      libraryNoteContent(libraryNoteType(kind, link.host), link.url),
    );
    dismissEditorNotice();
    // The note opens at once; its transcript follows (it notifies on failure).
    const videoId = youtubeVideoId(link.url);
    if (videoId) void bringInTranscript(path, videoId);
  } catch (error) {
    reportFailure(error);
  }
}

/** A note of `kind` with only a title: nothing is looked up. */
export async function addTitleToLibrary(title: string, kind: LibraryKind): Promise<void> {
  try {
    await createAndOpen(title, libraryNoteContent(libraryNoteType(kind, null), null));
  } catch (error) {
    reportFailure(error);
  }
}
