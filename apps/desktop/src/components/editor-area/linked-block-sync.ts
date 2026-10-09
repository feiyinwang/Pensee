import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { Annotation, type Extension, Facet } from "@codemirror/state";
import { listen } from "@tauri-apps/api/event";
import * as tauri from "@/lib/tauri";
import { LruCache } from "@/lib/lru";
import {
  bodyFitsSource,
  findBlock,
  minimalChange,
  replaceBlock,
  withIdMarker,
} from "@/lib/block-refs";
import * as editorApi from "@/hooks/editor-api";
import { showEditorNotice } from "./editor-notice-store";

// One owner for "the text of page P" as linked blocks see it, and for writing
// a linked block back into P. Per SPECs/block-embed-spec.md.
//
// Reads come from the freshest place that has the page: the editor store when
// the page is open (it may hold unsaved edits), else the file on disk (cached).
// Writes go where the page lives: into its live editor when one shows it — the
// edit then saves, undoes and syncs exactly like typing there — else into the
// store, else straight to disk (debounced). Every embed of a page is told when
// that page's text changes, whichever of the three changed it.

/** Marks a transaction a linked-block sync dispatched, so it is not written
 *  back to where it came from. */
export const linkedBlockSync = Annotation.define<true>();

/** The file path of the editor a view belongs to. Set by the main editor;
 *  absent in nested editors (previews, embeds), which therefore render
 *  `![[Page#^id]]` as a plain link — so an embed can never contain itself. */
export const blockEmbedHost = Facet.define<() => string, (() => string) | null>({
  combine: (values) => values[0] ?? null,
});

/* ---------------------------------------------------------- live editors */

// Main editors by the file they show. Registered from the `writer.swap` that
// loads a file, not from the path getter: the getter flips before the doc is
// swapped, and a write landing in between would go into the wrong page.
const liveViews = new Map<string, Set<EditorView>>();

function register(path: string, view: EditorView) {
  let views = liveViews.get(path);
  if (!views) liveViews.set(path, (views = new Set()));
  views.add(view);
}

function unregister(path: string, view: EditorView) {
  const views = liveViews.get(path);
  if (!views) return;
  views.delete(view);
  if (!views.size) liveViews.delete(path);
}

export function liveEditorRegistry(getFilePath: () => string): Extension {
  return ViewPlugin.fromClass(
    class {
      path: string;
      constructor(readonly view: EditorView) {
        this.path = getFilePath();
        if (this.path) register(this.path, view);
      }
      update(update: ViewUpdate) {
        if (!update.transactions.some((tr) => tr.isUserEvent("writer.swap"))) return;
        const next = getFilePath();
        if (next === this.path) return;
        if (this.path) unregister(this.path, this.view);
        this.path = next;
        if (next) register(next, this.view);
      }
      destroy() {
        if (this.path) unregister(this.path, this.view);
      }
    },
  );
}

/* ---------------------------------------------------------------- reads */

// Raw file text for pages that are not open. Bounded: only pages an embed is
// showing land here.
const diskText = new LruCache<string>(64);
const diskLoads = new Map<string, Promise<string>>();

function openText(path: string): string | null {
  const file = editorApi.getOpenFile(path);
  return file && !file.isLoading ? file.content : null;
}

/** The page's text right now, if it is already in memory. */
export function currentPageText(path: string): string | null {
  return openText(path) ?? diskText.get(path) ?? null;
}

/** The page's text, reading the file once if it is neither open nor cached. */
export async function loadPageText(path: string): Promise<string> {
  const inMemory = currentPageText(path);
  if (inMemory !== null) return inMemory;
  let load = diskLoads.get(path);
  if (!load) {
    load = tauri
      .readFile(path)
      .then((file) => {
        diskText.set(path, file.content);
        return file.content;
      })
      .finally(() => diskLoads.delete(path));
    diskLoads.set(path, load);
  }
  return load;
}

/* ---------------------------------------------------------- subscribers */

const listeners = new Map<string, Set<() => void>>();
const lastOpenText = new Map<string, string | null>();
let stopStore: (() => void) | null = null;
let watching = false;

function notify(path: string) {
  for (const listener of listeners.get(path) ?? []) listener();
}

function onStoreChange() {
  for (const path of listeners.keys()) {
    const text = openText(path);
    if (text === lastOpenText.get(path)) continue;
    lastOpenText.set(path, text);
    // Closing the page drops it back to disk, and the cache may predate
    // what was saved there: read it again rather than trust the cache.
    if (text === null) {
      void refreshFromDisk(path);
      continue;
    }
    notify(path);
  }
}

async function refreshFromDisk(path: string) {
  if (pendingWrites.has(path)) return; // Ours is newer; it lands shortly.
  try {
    const file = await tauri.readFile(path);
    if (openText(path) !== null) return;
    if (diskText.get(path) === file.content) return;
    diskText.set(path, file.content);
    notify(path);
  } catch (error) {
    console.error("[linked-block] Failed to re-read page:", error);
  }
}

function ensureWatching() {
  stopStore ??= editorApi.subscribeOpenFiles(onStoreChange);
  if (watching) return;
  watching = true;
  // Edits made outside the app to a page that is not open. Open pages reach
  // us through the store (the file watcher reloads them there).
  void listen<{ path: string; kind: string }>("fs:file-changed", (event) => {
    const { path, kind } = event.payload;
    if (kind === "deleted" || !listeners.has(path) || openText(path) !== null) return;
    void refreshFromDisk(path);
  }).catch((error) => {
    watching = false;
    console.error("[linked-block] Failed to watch pages:", error);
  });
}

/** Call `listener` whenever page `path`'s text changes. */
export function subscribePage(path: string, listener: () => void): () => void {
  ensureWatching();
  let set = listeners.get(path);
  if (!set) {
    listeners.set(path, (set = new Set()));
    lastOpenText.set(path, openText(path));
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size) return;
    listeners.delete(path);
    lastOpenText.delete(path);
    if (!listeners.size && stopStore) {
      stopStore();
      stopStore = null;
    }
  };
}

/* ---------------------------------------------------------------- writes */

const DISK_WRITE_DELAY_MS = 300;
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleDiskWrite(path: string) {
  const pending = pendingWrites.get(path);
  if (pending) clearTimeout(pending);
  pendingWrites.set(
    path,
    setTimeout(() => {
      pendingWrites.delete(path);
      const text = diskText.get(path);
      if (text === undefined) return;
      // `write_file` is the app's one write path; its self-write detection
      // keeps the watcher from echoing this back at us.
      tauri.writeFile(path, text).catch((error) => {
        console.error("[linked-block] Failed to save linked block:", error);
        showEditorNotice("Couldn't save the linked block to its page.");
      });
    }, DISK_WRITE_DELAY_MS),
  );
}

/**
 * Put `body` into block `id` of page `path`. Returns false when the block is
 * no longer in the page (its id was deleted there) — nothing is written then.
 */
export function writeBlock(path: string, id: string, body: string): boolean {
  const views = liveViews.get(path);
  if (views?.size) {
    let wrote = false;
    for (const view of views) {
      const doc = view.state.doc.toString();
      const range = findBlock(doc, id);
      if (!range) continue;
      wrote = true;
      if (!bodyFitsSource(doc, id, body)) {
        console.error("[linked-block] Refused a write that would change the blocks around", id);
        continue;
      }
      const marker = doc.slice(range.idFrom, range.idTo);
      const change = minimalChange(doc.slice(range.from, range.to), withIdMarker(body, marker));
      if (!change) continue;
      view.dispatch({
        changes: {
          from: range.from + change.from,
          to: range.from + change.to,
          insert: change.insert,
        },
        annotations: linkedBlockSync.of(true),
        userEvent: "input.linked-block",
      });
    }
    return wrote;
  }

  const open = openText(path);
  if (open !== null) {
    const next = replaceBlock(open, id, body);
    if (next === null) return false;
    if (!bodyFitsSource(open, id, body)) {
      console.error("[linked-block] Refused a write that would change the blocks around", id);
      return true;
    }
    if (next !== open) editorApi.updateContent(path, next);
    return true;
  }

  const disk = diskText.get(path);
  if (disk === undefined) return false;
  const next = replaceBlock(disk, id, body);
  if (next === null) return false;
  if (!bodyFitsSource(disk, id, body)) {
    console.error("[linked-block] Refused a write that would change the blocks around", id);
    return true;
  }
  if (next === disk) return true;
  diskText.set(path, next);
  scheduleDiskWrite(path);
  notify(path);
  return true;
}
