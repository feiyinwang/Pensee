import { Decoration, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { listen } from "@tauri-apps/api/event";
import * as tauri from "@/lib/tauri";
import { getFileStem } from "@/lib/paths";
import {
  blockIdsInText,
  blockText,
  citationContext,
  referencesInText,
  renderCitation,
} from "@/lib/block-refs";
import * as editorApi from "@/hooks/editor-api";
import { hoverCard, type HoverCardContent } from "./hover-card";
import { loadPageText } from "./linked-block-sync";
import { previewExtensions } from "./wiki-link-preview";

// The back half of linked blocks (SPECs/block-embed-spec.md#backlinks): a
// block other pages show carries a count of those places, and hovering the
// count lists them.
//
// Where references are found: the Rust scan (`find_block_references`) reads
// the files on disk; open pages are scanned here instead, from the store, so a
// reference pasted a second ago counts before it is saved. A page with no
// block ids starts nothing at all.

export interface Backlink {
  id: string;
  path: string;
  line: number;
  text: string;
}

/** Backlinks per block id, for the page this editor shows. */
export const setBacklinks = StateEffect.define<ReadonlyMap<string, readonly Backlink[]>>();

const EMPTY: ReadonlyMap<string, readonly Backlink[]> = new Map();

export const backlinksField = StateField.define<ReadonlyMap<string, readonly Backlink[]>>({
  create: () => EMPTY,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setBacklinks)) value = effect.value;
    return value;
  },
});

/* ------------------------------------------------------------- the service */

const LIVE_DELAY_MS = 300;
const DISK_DELAY_MS = 600;

interface Watch {
  ids: ReadonlySet<string>;
  onChange: (refs: ReadonlyMap<string, readonly Backlink[]>) => void;
  disk: readonly Backlink[];
  /** Bumped per disk request; a stale answer is dropped. */
  diskGeneration: number;
  last: string;
}

const watches = new Set<Watch>();
let liveTimer: ReturnType<typeof setTimeout> | null = null;
let diskTimer: ReturnType<typeof setTimeout> | null = null;
let stopStore: (() => void) | null = null;
let stopEvents: Array<Promise<() => void>> = [];
let lastOpenPaths = "";

function openPages(): Map<string, string> {
  const pages = new Map<string, string>();
  for (const [path, file] of editorApi.getOpenFiles()) {
    if (!file.isLoading) pages.set(path, file.content);
  }
  return pages;
}

function publish(watch: Watch) {
  const open = openPages();
  const byId = new Map<string, Backlink[]>();
  const add = (ref: Backlink) => {
    let list = byId.get(ref.id);
    if (!list) byId.set(ref.id, (list = []));
    list.push(ref);
  };
  // Disk for closed pages; the store's text for open ones.
  for (const ref of watch.disk) if (!open.has(ref.path)) add(ref);
  for (const [path, text] of open) {
    for (const ref of referencesInText(text, watch.ids)) add({ ...ref, path });
  }
  const key = JSON.stringify([...byId].map(([id, refs]) => [id, refs.map((r) => r.path + r.line)]));
  if (key === watch.last) return;
  watch.last = key;
  watch.onChange(byId);
}

function refreshDisk(watch: Watch) {
  const generation = ++watch.diskGeneration;
  tauri
    .findBlockReferences([...watch.ids])
    .then((refs) => {
      if (!watches.has(watch) || generation !== watch.diskGeneration) return;
      watch.disk = refs;
      publish(watch);
    })
    .catch((error) => console.error("[backlinks] Failed to find block references:", error));
}

function scheduleLive() {
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    liveTimer = null;
    for (const watch of watches) publish(watch);
  }, LIVE_DELAY_MS);
}

function scheduleDisk() {
  if (diskTimer) clearTimeout(diskTimer);
  diskTimer = setTimeout(() => {
    diskTimer = null;
    for (const watch of watches) refreshDisk(watch);
  }, DISK_DELAY_MS);
}

function onStoreChange() {
  // A page that closes drops back to disk, which the app saved without a
  // watcher event (self-writes are suppressed): ask disk again.
  const paths = [...editorApi.getOpenFiles().keys()].sort().join("\n");
  if (paths !== lastOpenPaths) {
    lastOpenPaths = paths;
    scheduleDisk();
  }
  scheduleLive();
}

function start() {
  lastOpenPaths = [...editorApi.getOpenFiles().keys()].sort().join("\n");
  stopStore = editorApi.subscribeOpenFiles(onStoreChange);
  // Edits from outside the app, and the first index finishing.
  stopEvents = [listen("fs:file-changed", scheduleDisk), listen("index:complete", scheduleDisk)];
}

function stop() {
  stopStore?.();
  stopStore = null;
  for (const unlisten of stopEvents) void unlisten.then((fn) => fn());
  stopEvents = [];
  if (liveTimer) clearTimeout(liveTimer);
  if (diskTimer) clearTimeout(diskTimer);
  liveTimer = diskTimer = null;
}

/** Report backlinks to `ids` now and whenever they change. */
function watchBacklinks(ids: ReadonlySet<string>, onChange: Watch["onChange"]): () => void {
  const watch: Watch = { ids, onChange, disk: [], diskGeneration: 0, last: "" };
  if (!watches.size) start();
  watches.add(watch);
  // The open pages answer at once; disk follows.
  queueMicrotask(() => watches.has(watch) && publish(watch));
  refreshDisk(watch);
  return () => {
    watches.delete(watch);
    if (!watches.size) stop();
  };
}

/* -------------------------------------------------------- the editor side */

const IDS_DELAY_MS = 400;

function idsKey(ids: string[]): string {
  return [...ids].sort().join(" ");
}

const backlinksPlugin = ViewPlugin.fromClass(
  class {
    private key = "";
    private unwatch: (() => void) | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(readonly view: EditorView) {
      this.sync();
    }

    update(update: ViewUpdate) {
      // A swap is a different page: its ids now. A keystroke may add or
      // remove one: look once typing pauses.
      if (update.transactions.some((tr) => tr.isUserEvent("writer.swap"))) {
        this.sync();
      } else if (update.docChanged) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          this.sync();
        }, IDS_DELAY_MS);
      }
    }

    private sync() {
      const ids = blockIdsInText(this.view.state.doc.toString());
      const key = idsKey(ids);
      if (key === this.key) return;
      this.key = key;
      this.unwatch?.();
      this.unwatch = null;
      if (!ids.length) {
        this.set(EMPTY);
        return;
      }
      this.unwatch = watchBacklinks(new Set(ids), (refs) => this.set(refs));
    }

    private set(refs: ReadonlyMap<string, readonly Backlink[]>) {
      if (this.view.state.field(backlinksField) === refs) return;
      if (refs === EMPTY && !this.view.state.field(backlinksField).size) return;
      this.view.dispatch({ effects: setBacklinks.of(refs) });
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
      this.unwatch?.();
    }
  },
);

/** The count at the end of a referenced block's line. */
export class BacklinkBadge extends WidgetType {
  constructor(
    readonly id: string,
    readonly count: number,
  ) {
    super();
  }

  eq(other: BacklinkBadge): boolean {
    return this.id === other.id && this.count === other.count;
  }

  toDOM(): HTMLElement {
    const badge = document.createElement("span");
    badge.className = "cm-block-refs-badge";
    badge.dataset.blockId = this.id;
    badge.textContent = String(this.count);
    badge.setAttribute(
      "aria-label",
      `Shown in ${this.count} ${this.count === 1 ? "place" : "places"}`,
    );
    return badge;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** At most this many places get a live preview; the rest are listed. */
const MAX_PREVIEWS = 5;
/** Lines of context each side of a citation: enough to place it, no more. */
const CONTEXT_LINES = 2;

const citeLine = Decoration.line({ class: "wr-backlink-cite" });

/** The hover card: each place that shows the block, as a few lines of that
 *  page with the citation in the middle — drawn as the block itself and
 *  highlighted — so you see the context, not a line number. Built on hover,
 *  destroyed with the card. */
async function backlinkPreview(
  view: EditorView,
  badge: HTMLElement,
  isStale: () => boolean,
): Promise<HoverCardContent | null> {
  const id = badge.dataset.blockId;
  const refs = id ? view.state.field(backlinksField).get(id) : undefined;
  if (!id || !refs?.length) return null;
  const body = blockText(view.state.doc.toString(), id) ?? "";
  const previewed = refs.slice(0, MAX_PREVIEWS);
  const texts = await Promise.all(
    previewed.map((ref) =>
      loadPageText(ref.path).catch((error: unknown) => {
        console.error("[backlinks] Failed to read a citing page:", error);
        return null;
      }),
    ),
  );
  if (isStale()) return null;

  const views: EditorView[] = [];
  let disposed = false;
  const content = document.createDocumentFragment();
  const title = document.createElement("p");
  title.className = "wr-backlinks-title";
  title.textContent = `Shown in ${refs.length} ${refs.length === 1 ? "place" : "places"}`;
  content.append(title);
  const list = document.createElement("div");
  list.className = "wr-backlinks-list";
  content.append(list);

  refs.forEach((ref, index) => {
    const item = document.createElement("div");
    item.className = "wr-backlinks-item";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "wr-backlinks-page";
    open.dataset.hoverCardClose = "";
    open.textContent = getFileStem(ref.path);
    open.title = "Open page";
    open.addEventListener("click", () => void editorApi.openLinkedPage(ref.path));
    item.append(open);

    const text = index < previewed.length ? texts[index] : null;
    if (text != null) {
      const { snippet, citeLine: at } = citationContext(text, ref.line, CONTEXT_LINES);
      const lines = snippet.split("\n");
      lines[at] = renderCitation(lines[at] ?? "", id, body);
      const doc = lines.join("\n");
      const host = document.createElement("div");
      host.className = "wr-backlinks-preview";
      host.dataset.inlineEditor = "";
      item.append(host);
      const citeFrom = at === 0 ? 0 : lines.slice(0, at).join("\n").length + 1;
      views.push(
        new EditorView({
          parent: host,
          state: EditorState.create({
            doc,
            extensions: [
              previewExtensions(ref.path, () => disposed),
              EditorView.decorations.of(Decoration.set(citeLine.range(citeFrom))),
            ],
          }),
        }),
      );
    }
    list.append(item);
  });

  return {
    element: content,
    label: title.textContent,
    destroy: () => {
      disposed = true;
      for (const preview of views) preview.destroy();
    },
  };
}

/** Backlink counts on referenced blocks, for the main editor. */
export function blockBacklinks(): Extension {
  return [
    backlinksField,
    backlinksPlugin,
    hoverCard({
      selector: ".cm-block-refs-badge",
      width: 440,
      maxHeight: 420,
      build: (badge, view, isStale) => backlinkPreview(view, badge, isStale),
    }),
  ];
}
