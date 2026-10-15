import { showEditorNotice } from "@/components/editor-area/editor-notice-store";
import { editPage } from "@/components/editor-area/linked-block-sync";
import { createNoteIn } from "@/hooks/use-spaces";
import { getWorkspaceChromeMode } from "@/lib/compact-mode";
import {
  EMPTY_DRAFT,
  appendBlock,
  appendListItem,
  dayLinkLine,
  isDraftEmpty,
  withDateProperty,
  withDay,
  withKind,
  type ComposerDraft,
  type ComposerTarget,
} from "@/lib/composer";
import { formatDailyNoteDate, resolveDailyNoteFile } from "@/lib/daily-note";
import { type LibraryKind, opensWhenAdded } from "@/lib/library-add";
import { getFileStem } from "@/lib/paths";
import { spaceFileStem } from "@/lib/spaces";
import * as tauri from "@/lib/tauri";
import { useComposerStore } from "@/stores/composer-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

// The composer's entry points and writes (SPECs/composer-spec.md). Every way
// in — ⌘N, ⌘⇧N, ⌘⇧L, a Library tab's Add, the tab bar's + — goes through
// `openComposer`; every write through `submitComposer`.

export interface ComposerPreset {
  /** ⌘⇧N: the day is today. */
  today?: boolean;
  /** ⌘⇧L (true) or a Library tab's Add (its kind). */
  library?: LibraryKind | true;
}

/** The window has a workspace to file into, and isn't a compact one-file window. */
function canCompose(): boolean {
  const { root, chromeMode } = useWorkspaceStore.getState();
  return Boolean(root) && getWorkspaceChromeMode(root, chromeMode) !== "compact-file";
}

/** The New tab page shows the composer in place; it takes ⌘N there. */
export function isLauncherActive(): boolean {
  const { tabs, activeTabId } = useEditorStore.getState();
  return tabs.find((tab) => tab.id === activeTabId)?.location.kind === "launcher";
}

export function openComposer(preset: ComposerPreset = {}): void {
  if (!canCompose()) return;
  const store = useComposerStore.getState();
  let draft = store.draft;
  // A draft with nothing in it starts over as a plain note; one with text
  // comes back as it was left.
  if (isDraftEmpty(draft)) draft = { ...EMPTY_DRAFT, folder: draft.folder };
  if (preset.today) draft = withDay(draft, formatDailyNoteDate(new Date()));
  if (preset.library === true) {
    draft = {
      ...draft,
      kind: draft.kind === "note" ? "book" : draft.kind,
      kindPicked: false,
    };
  } else if (preset.library) {
    draft = withKind(draft, preset.library);
  }
  if (draft !== store.draft) store.setDraft(draft);
  if (!isLauncherActive()) store.setOpen(true);
  store.requestFocus();
}

export function closeComposer(): void {
  useComposerStore.getState().setOpen(false);
}

/** Where a dropped PDF or EPUB goes: into the composer when it is showing. */
export function attachToComposer(path: string): boolean {
  const store = useComposerStore.getState();
  if (!store.open && !isLauncherActive()) return false;
  const draft = store.draft;
  store.setDraft({
    ...draft,
    file: path,
    kind: /\.epub$/i.test(path) ? "book" : draft.kind === "paper" ? "paper" : "book",
    // An EPUB is a book; a PDF is read once it is in the vault, unless picked.
    kindPicked: /\.epub$/i.test(path),
  });
  store.requestFocus();
  return true;
}

function bodyText(body: string): string {
  const text = body.trim();
  return text ? `${text}\n` : "";
}

/** After a write the box closes and starts over. The page stays where it
 *  is, with an "Added …" notice to open the note, unless `open` (⌘⇧↵). */
async function finish(path: string | null, name: string, open: boolean): Promise<void> {
  const store = useComposerStore.getState();
  store.setDraft({ ...EMPTY_DRAFT, folder: store.draft.folder });
  store.setOpen(false);
  if (!path) return;
  if (open) {
    await useEditorStore.getState().openFile(path);
    return;
  }
  showEditorNotice(`Added ${name}`, {
    label: "Open",
    run: () => void useEditorStore.getState().openFile(path),
  });
}

/** The day's note for `day` (`YYYY-MM-DD`), made if missing. */
async function dayNotePath(day: string): Promise<string> {
  const root = useWorkspaceStore.getState().root;
  if (!root) throw new Error("Open a folder first");
  const folder = useSettingsStore.getState().getSetting("workspace.daily-note-folder") ?? "";
  const resolved = resolveDailyNoteFile(root, folder, `${day}.md`);
  if (!resolved.ok) throw new Error(resolved.error);
  await tauri.createFileIfMissing(resolved.path);
  return resolved.path;
}

/** Give a Library note or an imported book its `Date` property. */
async function stampDate(path: string, draft: ComposerDraft): Promise<void> {
  if (!draft.day) return;
  const value = draft.day;
  try {
    await editPage(path, (page) => ({
      frontmatter: withDateProperty(page.frontmatter, value),
      body: page.body,
    }));
  } catch (error) {
    console.error(`[composer] Couldn't date ${path}:`, error);
    showEditorNotice(
      `Couldn't set the date of ${getFileStem(path)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Link the note at `path` from `day`'s note, at its end. */
async function linkIntoDay(day: string, path: string): Promise<void> {
  try {
    const dayPath = await dayNotePath(day);
    await editPage(dayPath, (page) => ({
      frontmatter: page.frontmatter,
      body: appendListItem(page.body, dayLinkLine(getFileStem(path))),
    }));
  } catch (error) {
    console.error(`[composer] Couldn't link ${path} from ${day}:`, error);
    showEditorNotice(
      `Couldn't add the link to ${day}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** A free `Untitled`, `Untitled 2`… in `folder`. */
async function freeUntitled(root: string, folder: string | null): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? "Untitled" : `Untitled ${n}`;
    if (!(await tauri.fileExists(notePath(root, folder, name)))) return name;
  }
  throw new Error("Too many untitled notes");
}

function notePath(root: string, folder: string | null, name: string): string {
  const stem = spaceFileStem(name) ?? name;
  return folder ? `${root}/${folder}/${stem}.md` : `${root}/${stem}.md`;
}

async function writeNote(
  target: Extract<ComposerTarget, { kind: "note" }>,
  draft: ComposerDraft,
  open: boolean,
) {
  const root = useWorkspaceStore.getState().root;
  if (!root) throw new Error("Open a folder first");
  const untitled = !draft.title.trim();
  const name = untitled ? await freeUntitled(root, target.folder) : target.name;
  const path = notePath(root, target.folder, name);
  if (await tauri.fileExists(path)) {
    useComposerStore.getState().setError({
      message: `A note named "${getFileStem(path)}" already exists`,
      path,
    });
    return;
  }
  const frontmatter = draft.day ? `---\n${withDateProperty(null, draft.day)}\n---\n` : "";
  const created = await createNoteIn(target.folder, name, () => frontmatter + bodyText(draft.body));
  if (draft.day) await linkIntoDay(draft.day, created.path);
  await finish(created.path, created.stem, open);
}

/** A date and no title: the text goes to the end of the day's note, and the
 *  day's note opens, so ⌘↵ lands where the writing went. */
async function writeDay(day: string, draft: ComposerDraft) {
  const path = await dayNotePath(day);
  if (draft.body.trim()) {
    await editPage(path, (page) => ({
      frontmatter: page.frontmatter,
      body: appendBlock(page.body, draft.body),
    }));
  }
  await finish(path, day, true);
}

/** Do what `target` says with the box's draft; `open` (⌘⇧↵) goes to the
 *  note (a day's note always opens). Notes and days are written before the
 *  box lets go, so a name clash shows in it; Library adds read the web or
 *  copy a file, so the box lets go first and a notice follows. A date links
 *  the new note from that day. */
export async function submitComposer(target: ComposerTarget, open = false): Promise<void> {
  const store = useComposerStore.getState();
  if (store.busy || target.kind === "empty") return;
  const { draft } = store;

  if (target.kind === "note" || target.kind === "day") {
    store.setBusy(true);
    try {
      if (target.kind === "note") await writeNote(target, draft, open);
      else await writeDay(target.day, draft);
    } catch (error) {
      console.error("[composer] Couldn't write the note:", error);
      store.setError({ message: error instanceof Error ? error.message : String(error) });
    } finally {
      useComposerStore.getState().setBusy(false);
    }
    return;
  }

  if (target.kind === "link" && target.existing) {
    if (draft.day) await linkIntoDay(draft.day, target.existing.path);
    await finish(target.existing.path, "", true);
    return;
  }

  // The box lets go now; the add reports its own progress and failures.
  await finish(null, "", false);
  const { addLinkToLibrary, addTitleToLibrary } = await import("@/hooks/use-library-add");
  // A podcast's note is its player: it opens, ready for ⌘⇧J.
  const opens = open || (target.kind === "link" && opensWhenAdded(target.library));
  let path: string | null = null;
  if (target.kind === "link") {
    path = await addLinkToLibrary(target.link, target.library, { body: draft.body, open: opens });
  } else if (target.kind === "title") {
    path = await addTitleToLibrary(target.title, target.library, { body: draft.body, open });
  } else {
    path = await importAttached(target.path, target.library ?? undefined, draft.body, open);
  }
  if (!path) return;
  if (draft.day) {
    await stampDate(path, draft);
    await linkIntoDay(draft.day, path);
  }
  if (!opens) {
    showEditorNotice(`Added ${getFileStem(path)}`, {
      label: "Open",
      run: () => void useEditorStore.getState().openFile(path),
    });
  }
}

async function importAttached(
  file: string,
  type: "book" | "paper" | undefined,
  body: string,
  open: boolean,
): Promise<string | null> {
  try {
    const { importBook } = await import("@/lib/book-import");
    const path = await importBook(file, { type, open });
    if (path && body.trim()) {
      await editPage(path, (page) => ({
        frontmatter: page.frontmatter,
        body: appendBlock(page.body, body),
      }));
    }
    return path;
  } catch (error) {
    console.error(`[composer] Couldn't import ${file}:`, error);
    showEditorNotice(
      `Couldn't add ${getFileStem(file)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
