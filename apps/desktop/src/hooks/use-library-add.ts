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
import { openComposer } from "@/hooks/use-composer";
import { useWorkspaceStore } from "@/stores/workspace-store";

// Adding a Library note (SPECs/add-to-library-spec.md), from the composer or a
// link pasted in ⌘O. Nothing touches the network until the add is chosen; the
// page's title is read then, and the note is named by it.

// A page slower than this gets a note named from its link instead.
const TITLE_TIMEOUT_MS = 5000;

/** Open the composer ready for Library; `kind` is a Library tab's. */
export function openLibraryAdd(kind: LibraryKind | null = null): void {
  openComposer({ library: kind ?? true });
}

export interface LibraryAddOptions {
  /** Text under the note's properties. */
  body?: string;
  /** Open the note once it is written (the composer only does on ⌘⇧↵). */
  open?: boolean;
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
 *  it unless `open` is false, and return its path. */
async function createAndOpen(name: string, content: string, open = true): Promise<string> {
  const root = useWorkspaceStore.getState().root;
  if (!root) throw new Error("Open a folder first");
  const base = safePageName(name);
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base} ${n}`;
    const stem = spaceFileStem(candidate);
    if (!stem) throw new Error("That has no usable name");
    if (await tauri.fileExists(`${root}/${stem}.md`)) continue;
    const { path } = await createRootNote(candidate, () => content);
    if (open) await useEditorStore.getState().openFile(path);
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

function withBody(frontmatter: string, body: string | undefined): string {
  const text = body?.trim();
  return text ? `${frontmatter}${text}\n` : frontmatter;
}

/** A note of `kind` for `link`, named by the page's title. Returns its path,
 *  or null when it couldn't be made (the failure is shown). */
export async function addLinkToLibrary(
  link: LibraryLink,
  kind: LibraryKind,
  { body, open = true }: LibraryAddOptions = {},
): Promise<string | null> {
  try {
    showEditorNotice(`Adding ${link.host}…`);
    const title = (await linkTitle(link)) || fallbackLinkTitle(link);
    const path = await createAndOpen(
      title,
      withBody(libraryNoteContent(libraryNoteType(kind, link.host), link.url), body),
      open,
    );
    dismissEditorNotice();
    // The note opens at once; its transcript follows (it notifies on failure).
    const videoId = youtubeVideoId(link.url);
    if (videoId) void bringInTranscript(path, videoId);
    return path;
  } catch (error) {
    reportFailure(error);
    return null;
  }
}

/** A note of `kind` with only a title: nothing is looked up. Returns its
 *  path, or null when it couldn't be made (the failure is shown). */
export async function addTitleToLibrary(
  title: string,
  kind: LibraryKind,
  { body, open = true }: LibraryAddOptions = {},
): Promise<string | null> {
  try {
    return await createAndOpen(
      title,
      withBody(libraryNoteContent(libraryNoteType(kind, null), null), body),
      open,
    );
  } catch (error) {
    reportFailure(error);
    return null;
  }
}
