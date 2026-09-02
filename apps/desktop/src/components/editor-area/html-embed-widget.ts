import { EditorSelection } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { getFileName } from "@/lib/paths";
import {
  HTML_EMBED_MAX_HEIGHT,
  HTML_EMBED_MIN_HEIGHT,
  findWikiLinkAt,
  withWikiEmbedHeight,
} from "@/lib/wiki-links";
import { resolveEmbedPath } from "./wiki-embed-resolver";
import "./html-embed.css";

// Header strip + frame border + wrapper padding, mirrored from html-embed.css
// so `estimatedHeight` matches the rendered box before the file resolves.
const HEADER_HEIGHT = 28;
const FRAME_CHROME = 2 + 12;

// The page runs with an opaque origin: no `allow-same-origin`, so it cannot
// read the editor document, share storage with the app, or pass Tauri's IPC
// origin check. No `allow-top-navigation`, so it cannot redirect the window.
const SANDBOX = "allow-scripts allow-forms";

const ICONS = {
  reload: ["M20 12a8 8 0 11-2.3-5.7", "M20 4v4.3h-4.3"],
  open: ["M14 5h5v5", "M19 5l-8 8", "M17 13v6H5V7h6"],
  edit: ["M9 8l-4 4 4 4", "M15 8l4 4-4 4"],
};

interface FrameParts {
  frame: HTMLElement;
  iframe: HTMLIFrameElement;
  title: HTMLElement;
  absolutePath: string | null;
}

// Live frame DOM per widget root, so `updateDOM` can apply a new height in
// place (a drag write-back must not reload the page) and `destroy` can drop
// the reload registration. Weak so disposed roots don't leak.
const frameParts = new WeakMap<HTMLElement, FrameParts>();

// ---------------------------------------------------------------------------
// Live reload: one listener on the file watcher, a registry of mounted frames
// keyed by absolute path. Registered lazily by the first embed that mounts.
// ---------------------------------------------------------------------------

const mountedFrames = new Map<string, Set<HTMLIFrameElement>>();
let watcherStarted = false;

function reloadFrame(iframe: HTMLIFrameElement) {
  // Re-assigning the same `src` is not a reliable reload across engines, and
  // `contentWindow.location.reload()` is refused for an opaque origin. Blank
  // the frame and navigate back next frame instead.
  const src = iframe.dataset.src;
  if (!src) return;
  iframe.src = "about:blank";
  requestAnimationFrame(() => {
    if (iframe.isConnected) iframe.src = src;
  });
}

function ensureWatcher() {
  if (watcherStarted) return;
  watcherStarted = true;
  void listen<{ path: string; kind: string }>("fs:file-changed", (event) => {
    if (event.payload.kind === "deleted") return;
    const frames = mountedFrames.get(event.payload.path);
    if (!frames) return;
    for (const iframe of frames) reloadFrame(iframe);
  }).catch((error) => {
    watcherStarted = false;
    console.error("[editor] Failed to watch HTML embeds for changes:", error);
  });
}

function registerFrame(absolutePath: string, iframe: HTMLIFrameElement) {
  ensureWatcher();
  let frames = mountedFrames.get(absolutePath);
  if (!frames) {
    frames = new Set();
    mountedFrames.set(absolutePath, frames);
  }
  frames.add(iframe);
}

function unregisterFrame(absolutePath: string, iframe: HTMLIFrameElement) {
  const frames = mountedFrames.get(absolutePath);
  if (!frames) return;
  frames.delete(iframe);
  if (frames.size === 0) mountedFrames.delete(absolutePath);
}

// ---------------------------------------------------------------------------
// Source edits. Positions are looked up live from the widget root, never
// stored: the `![[...]]` token is found on the line `posAtDOM` lands on.
// ---------------------------------------------------------------------------

function locateEmbed(view: EditorView, root: HTMLElement) {
  const match = findWikiLinkAt(view.state.doc, view.posAtDOM(root));
  return match?.embed ? match : null;
}

/** Range-select the whole `![[...]]` so the source shows for editing — the
 *  same reverse-anchor convention the other fold widgets use. */
function selectEmbedSource(view: EditorView, root: HTMLElement) {
  const match = locateEmbed(view, root);
  if (!match) return;
  view.dispatch({
    selection: EditorSelection.single(match.to, match.from),
    effects: view.scrollSnapshot(),
  });
  view.focus();
}

function writeEmbedHeight(view: EditorView, root: HTMLElement, height: number) {
  const match = locateEmbed(view, root);
  if (!match) return;
  view.dispatch({
    changes: {
      from: match.from,
      to: match.to,
      insert: `![[${withWikiEmbedHeight(match.inner, height)}]]`,
    },
    userEvent: "input.resize",
  });
}

function clampHeight(height: number) {
  return Math.min(HTML_EMBED_MAX_HEIGHT, Math.max(HTML_EMBED_MIN_HEIGHT, Math.round(height)));
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function makeButton(icon: string[], title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-html-embed-button";
  button.title = title;
  button.setAttribute("aria-label", title);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of icon) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  button.append(svg);
  // Keep the editor focused: without this the button takes focus on press
  // and the editor loses its selection highlight for the click.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function attachResizeHandle(
  view: EditorView,
  root: HTMLElement,
  frame: HTMLElement,
  iframe: HTMLIFrameElement,
) {
  const handle = document.createElement("div");
  handle.className = "cm-html-embed-resize";
  handle.setAttribute("aria-hidden", "true");
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = Math.round(iframe.getBoundingClientRect().height);
    let height = startHeight;
    handle.setPointerCapture(event.pointerId);
    frame.classList.add("is-resizing");

    const onMove = (move: PointerEvent) => {
      height = clampHeight(startHeight + move.clientY - startY);
      iframe.style.height = `${height}px`;
    };
    const finish = (commit: boolean) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      frame.classList.remove("is-resizing");
      if (commit && height !== startHeight) {
        writeEmbedHeight(view, root, height);
      } else {
        iframe.style.height = `${startHeight}px`;
      }
      view.requestMeasure();
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
  });
  frame.append(handle);
}

/** Obsidian-style HTML file embed `![[page.html]]` / `![[page.html|480]]`.
 *  Renders the resolved file in a sandboxed frame with a header (file name,
 *  reload, open externally, edit source) and a bottom drag handle whose
 *  release writes the new height back as the `|N` modifier. Unresolved
 *  targets render the raw source text as a muted placeholder. Identity is
 *  the visual state only; positions are derived at click time. */
export class HtmlEmbedWidget extends WidgetType {
  constructor(
    readonly rawText: string,
    readonly target: string,
    readonly height: number,
    readonly workspaceRoot: string | null,
    readonly currentFilePath: string | null,
  ) {
    super();
  }

  eq(other: HtmlEmbedWidget): boolean {
    return (
      this.rawText === other.rawText &&
      this.target === other.target &&
      this.height === other.height &&
      this.workspaceRoot === other.workspaceRoot &&
      this.currentFilePath === other.currentFilePath
    );
  }

  get estimatedHeight(): number {
    return this.height + HEADER_HEIGHT + FRAME_CHROME;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("span");
    root.className = "cm-html-embed";
    root.contentEditable = "false";

    const frame = document.createElement("div");
    frame.className = "cm-html-embed-frame";

    const header = document.createElement("div");
    header.className = "cm-html-embed-header";
    const title = document.createElement("span");
    title.className = "cm-html-embed-title";
    title.textContent = getFileName(this.target);
    header.append(title);

    const iframe = document.createElement("iframe");
    iframe.className = "cm-html-embed-iframe";
    iframe.setAttribute("sandbox", SANDBOX);
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.title = `Embedded HTML: ${getFileName(this.target)}`;
    iframe.dataset.target = this.target;
    iframe.style.height = `${this.height}px`;

    const parts: FrameParts = { frame, iframe, title, absolutePath: null };
    frameParts.set(root, parts);

    header.append(
      makeButton(ICONS.reload, "Reload", () => reloadFrame(iframe)),
      makeButton(ICONS.open, "Open in browser", () => {
        if (!parts.absolutePath) return;
        void openPath(parts.absolutePath).catch((error) => {
          console.error("[editor] Failed to open HTML embed externally:", error);
        });
      }),
      makeButton(ICONS.edit, "Edit source", () => selectEmbedSource(view, root)),
    );

    frame.append(header, iframe);
    attachResizeHandle(view, root, frame, iframe);
    root.append(frame);

    void resolveEmbedPath(this.target, this.workspaceRoot, this.currentFilePath)
      .then((absolutePath) => {
        // Destroyed (or replaced by the placeholder) while resolving.
        if (!frameParts.has(root)) return;
        if (!absolutePath) {
          this.renderPlaceholder(view, root);
          return;
        }
        parts.absolutePath = absolutePath;
        const src = convertFileSrc(absolutePath);
        iframe.dataset.src = src;
        iframe.src = src;
        registerFrame(absolutePath, iframe);
      })
      .catch((error) => {
        console.error("[editor] Failed to resolve HTML embed:", error);
        this.renderPlaceholder(view, root);
      });

    return root;
  }

  private renderPlaceholder(view: EditorView, root: HTMLElement) {
    frameParts.delete(root);
    root.replaceChildren();
    root.classList.add("cm-html-embed-unresolved");
    root.textContent = this.rawText;
    const note = document.createElement("span");
    note.className = "cm-html-embed-unresolved-note";
    note.textContent = "file not found";
    root.append(note);
    root.addEventListener("click", (event) => {
      event.preventDefault();
      selectEmbedSource(view, root);
    });
    view.requestMeasure();
  }

  // Same file, new height (the drag write-back, or a hand-edited modifier):
  // keep the DOM so the page is not reloaded. Anything else rebuilds.
  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const parts = frameParts.get(dom);
    if (!parts || parts.iframe.dataset.target !== this.target) return false;
    parts.iframe.style.height = `${this.height}px`;
    return true;
  }

  destroy(dom: HTMLElement): void {
    const parts = frameParts.get(dom);
    if (parts?.absolutePath) unregisterFrame(parts.absolutePath, parts.iframe);
    frameParts.delete(dom);
  }

  ignoreEvent(): boolean {
    // The frame owns pointer interaction (buttons, drag handle, the page
    // itself). Without this CodeMirror would also try to place the caret at
    // the replaced range on every click.
    return true;
  }
}
