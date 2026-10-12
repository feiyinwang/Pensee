import { useEffect, useMemo, useRef, useState } from "react";
import { useSidebarMetadataVersion } from "@/hooks/use-file-tree";
import { useWorkspaceRoot } from "@/hooks/use-workspace";
import {
  BUILT_IN_SPACES,
  FILES_SPACE_KEY,
  SPACE_NOTE_TYPE,
  builtInSpace,
  noteSpaceKey,
  spaceFileStem,
  spaceFromNote,
  spaceNoteContent,
  type SpaceDef,
  type SpaceView,
} from "@/lib/spaces";
import {
  asProjectFrontmatter,
  isProjectType,
  noteType,
  projectNoteContent,
  type ProjectEdit,
} from "@/lib/projects";
import { getFileStem } from "@/lib/paths";
import * as tauri from "@/lib/tauri";
import { editPage, readPageParts } from "@/components/editor-area/linked-block-sync";
import type { SpaceLocation } from "@/components/editor-area/page-kinds";
import { isSameSpace } from "@/components/editor-area/page-kinds/space";
import { createSpaceTab, useEditorStore } from "@/stores/editor-store";
import { useUIStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

export type { SpaceDef } from "@/lib/spaces";
export type { TypedNote } from "@/lib/tauri";

// Saves bump the metadata version while typing; one read after the burst is enough.
const REFETCH_DELAY_MS = 300;

const SPACE_TYPES = [SPACE_NOTE_TYPE];

/** The last read per workspace and set of types, so a space opened again
 *  paints its notes on the first frame while the reread runs behind it. */
const lastReads = new Map<string, tauri.TypedNote[]>();

/** Notes whose `Type` is one of `types`, newest edit first; `null` until the
 *  first read lands. Reads at once on mount; rereads when files change. */
export function useTypedNotes(types: readonly string[]): tauri.TypedNote[] | null {
  const root = useWorkspaceRoot();
  const metadataVersion = useSidebarMetadataVersion();
  const typesKey = types.join("\n");
  const key = root && typesKey ? `${root}\n${typesKey}` : null;
  const [read, setRead] = useState<{ key: string; notes: tauri.TypedNote[] } | null>(null);
  // The key this hook last started a read for: only rereads after a file
  // change wait. Set when the read starts, so an effect cancelled before then
  // (StrictMode's double run) still reads at once.
  const readKey = useRef<string | null>(null);

  useEffect(() => {
    if (!key) return;
    const delay = readKey.current === key ? REFETCH_DELAY_MS : 0;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      readKey.current = key;
      tauri
        .listTypedNotes(typesKey.split("\n"))
        .then((notes) => {
          lastReads.set(key, notes);
          if (!cancelled) setRead({ key, notes });
        })
        .catch((error: unknown) => {
          console.error("[spaces] list_typed_notes failed", error);
          if (!cancelled) setRead({ key, notes: [] });
        });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, typesKey, metadataVersion]);

  if (!key) return null;
  return read?.key === key ? read.notes : (lastReads.get(key) ?? null);
}

/** Built-in spaces, then the spaces you added (`Type: Space` notes) by name. */
export function useSpaces(): SpaceDef[] {
  const notes = useTypedNotes(SPACE_TYPES);
  return useMemo(() => {
    const added = (notes ?? []).map(spaceFromNote).sort((a, b) => a.name.localeCompare(b.name));
    return [...BUILT_IN_SPACES, ...added];
  }, [notes]);
}

export function spaceLocationOf(space: SpaceDef): SpaceLocation {
  return space.path
    ? { kind: "space", space: "note", path: space.path }
    : { kind: "space", space: space.key };
}

export function spaceKeyOf(location: SpaceLocation): string {
  return location.path ? noteSpaceKey(location.path) : location.space;
}

/** The key of the space the active tab shows, or null. */
export function useActiveSpaceKey(): string | null {
  return useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.location.kind === "space" ? spaceKeyOf(tab.location) : null;
  });
}

/** Focus the tab already showing `location`, else open it (in place of a launcher). */
export function openSpace(location: SpaceLocation): void {
  useEditorStore.getState().openOrFocus(
    (tab) => tab.location.kind === "space" && isSameSpace(tab.location, location),
    () => createSpaceTab(location),
  );
}

/** The definition behind a location: a built-in, or the space note's latest
 *  state. `undefined` while the space notes load; `null` when the note is no
 *  longer a space. */
export function useSpaceDef(location: SpaceLocation): SpaceDef | null | undefined {
  const notes = useTypedNotes(SPACE_TYPES);
  if (!location.path) return builtInSpace(location.space) ?? null;
  if (notes === null) return undefined;
  const note = notes.find((n) => n.path === location.path);
  return note ? spaceFromNote(note) : null;
}

/** Write `<Name>.md` at the vault root with the content `content(stem)` gives.
 *  Throws a message fit to show when the name is unusable or taken. */
export async function createRootNote(
  name: string,
  content: (stem: string) => string,
): Promise<{ path: string; stem: string }> {
  const root = useWorkspaceStore.getState().root;
  if (!root) throw new Error("Open a folder first");
  const stem = spaceFileStem(name);
  if (!stem) throw new Error("Enter a name first");
  const path = `${root}/${stem}.md`;
  if (await tauri.fileExists(path)) throw new Error(`A note named "${stem}" already exists`);
  const created = await tauri.createFileIfMissing(path);
  if (created.content !== "") throw new Error(`A note named "${stem}" already exists`);
  await tauri.writeFile(path, content(stem));
  return { path, stem };
}

/** Write `<Name>.md` at the vault root as a space note and open it. */
export async function createSpaceNote(name: string, type: string, view: SpaceView): Promise<void> {
  const { path } = await createRootNote(name, (stem) =>
    spaceNoteContent(type.trim() || stem, view),
  );
  openSpace({ kind: "space", space: "note", path });
}

/** The markdown note named `name` anywhere in the vault (the file name,
 *  ignoring case), so adding "Trip" to a board takes the "Trip" note you
 *  already have; null when there is none. When several share the name, one
 *  `preferred` says first, then the shortest path, as embeds pick. Throws when
 *  the name is unusable. */
export async function findNoteNamed(
  name: string,
  preferred: (path: string) => boolean = () => false,
): Promise<string | null> {
  const root = useWorkspaceStore.getState().root;
  if (!root) throw new Error("Open a folder first");
  const stem = spaceFileStem(name);
  if (!stem) throw new Error("Enter a name first");
  const wanted = stem.toLowerCase();
  const matches = (await tauri.fuzzySearch(stem, 50))
    .filter((r) => /\.(md|markdown)$/i.test(r.filename))
    .filter((r) => getFileStem(r.filename).toLowerCase() === wanted)
    .map((r) => r.path)
    .sort((a, b) => Number(preferred(b)) - Number(preferred(a)) || a.length - b.length);
  return matches[0] ?? null;
}

/** Make the note at `path` a project with `edit`'s fields. A note of another
 *  type keeps it unless `confirmRetype` agrees (it would leave that type's
 *  space); returns whether the note is now a project. */
export async function adoptProjectNote(
  path: string,
  edit: ProjectEdit,
  confirmRetype: (type: string) => boolean,
): Promise<boolean> {
  const type = noteType((await readPageParts(path)).frontmatter);
  if (type !== null && !isProjectType(type) && !confirmRetype(type)) return false;
  await editPage(path, (page) => ({
    ...page,
    frontmatter: asProjectFrontmatter(page.frontmatter, edit),
  }));
  return true;
}

/** Write `<Name>.md` at the vault root as a project note with `edit`'s fields
 *  set; opens nothing. For a name no note has yet (see `findNoteNamed`). */
export function createProjectNote(
  name: string,
  edit: ProjectEdit,
): Promise<{ path: string; stem: string }> {
  return createRootNote(name, () => projectNoteContent(edit));
}

/** The Files space tree's inline-rename target, shared with the sidebar's
 *  "New file / New folder" so a new entry is renamed where it shows. */
export function useFileTreeRenaming(): [string | null, (path: string | null) => void] {
  const path = useUIStore((s) => s.fileTreeRenamingPath);
  const set = useUIStore((s) => s.setFileTreeRenamingPath);
  return [path, set];
}

export function startFileTreeRename(path: string): void {
  useUIStore.getState().setFileTreeRenamingPath(path);
}

export function openFilesSpace(): void {
  openSpace({ kind: "space", space: FILES_SPACE_KEY });
}
