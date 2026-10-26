/**
 * Everything that touches disk for a `.board.svg`: creating one, opening it in
 * the full-screen editor, writing it back, and keeping the in-note preview —
 * which is nothing but the image widget's `<img>` — current after a save.
 *
 * The preview needs no JavaScript at load time; that is the point of the
 * format. Only Open reads and parses the file.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { imageWidgetEnhancerFacet } from "@/lib/prosemark-core/main";
import {
  decodeLinkPath,
  getParentDir,
  isAbsolutePath,
  normalizeMarkdownDestination,
} from "@/lib/paths";
import * as tauri from "@/lib/tauri";
import { type BoardScene, emptyScene } from "./board-model";
import { mermaidToElements } from "./board-mermaid";
import { measureText } from "./board-render";
import {
  isBoardFile,
  readBoardSvg,
  relativePath,
  renderBoardSvg,
  withCurrentStyle,
} from "./board-file";
import { openBoardFullscreen } from "./board-fullscreen";
import { bookLinkSync } from "./board-book-links";
import { prefetchBoardChrome } from "./board-canvas";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PASSTHROUGH = /^(https?:|data:|blob:|asset:)/;

/* ------------------------------------------------------------- paths */

export function absoluteFrom(dir: string, src: string): string {
  const local = decodeLinkPath(normalizeMarkdownDestination(src));
  return isAbsolutePath(local) ? local : `${dir.replace(/\/$/, "")}/${local}`;
}

/** Resolves a board picture for the live editor (an `asset:` URL). */
export function editorResolver(dir: string | null): (src: string) => string {
  return (src) => {
    if (!src) return "";
    const normalized = normalizeMarkdownDestination(src);
    if (PASSTHROUGH.test(normalized) || !dir) return normalized;
    return convertFileSrc(absoluteFrom(dir, normalized));
  };
}

/* ------------------------------------------------------------ images */

async function naturalSize(file: File): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Copies a pasted/dropped picture into the note's assets folder and returns
 * its path relative to `srcDir` — the folder the scene's paths are relative to
 * (the note's for a legacy fence, the board file's for a `.board.svg`).
 */
export function importerFor(notePath: string | null, srcDir: string | null) {
  if (!notePath || !srcDir) return undefined;
  return async (file: File): Promise<{ src: string; w: number; h: number } | null> => {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
    const size = await naturalSize(file);
    const format = file.type.split("/")[1] || "png";
    const saved = await tauri.saveClipboardImage(
      notePath,
      Array.from(new Uint8Array(buffer)),
      format,
    );
    return { src: relativePath(srcDir, saved.absolute_path), w: size.w, h: size.h };
  };
}

/** Picture files are timestamp-named and never rewritten, so one read each
 *  per session is enough. */
const dataUrls = new Map<string, Promise<string>>();

function dataUrlFor(absolute: string): Promise<string> {
  let pending = dataUrls.get(absolute);
  if (!pending) {
    pending = tauri.readFileDataUrl(absolute);
    pending.catch(() => dataUrls.delete(absolute));
    dataUrls.set(absolute, pending);
  }
  return pending;
}

/** The file text, with every picture inlined (see `board-file.ts`). */
export async function boardFileText(scene: BoardScene, svgDir: string): Promise<string> {
  const srcs = new Set<string>();
  for (const el of scene.els) if (el.t === "image" && el.src) srcs.add(el.src);
  const inlined = new Map<string, string>();
  await Promise.all(
    [...srcs].map(async (src) => {
      if (src.startsWith("data:")) return inlined.set(src, src);
      try {
        inlined.set(src, await dataUrlFor(absoluteFrom(svgDir, src)));
      } catch (error) {
        // A missing picture must not cost the user the rest of the board.
        // It renders as an empty frame and the scene keeps its path.
        console.error(`[board] could not inline ${src}`, error);
      }
    }),
  );
  return renderBoardSvg(scene, (src) => inlined.get(src) ?? "");
}

/* ------------------------------------------------------- write queue */

/** Last text written (or read) per file — skips the write when closing a board
 *  that was only looked at, which is the common case when presenting. */
const lastText = new Map<string, string>();
const chains = new Map<string, Promise<void>>();
const versions = new Map<string, number>();

/** Files written since their in-note preview was last refreshed. */
const stalePreviews = new Set<string>();

/**
 * `refresh` reloads the note's `<img>` for this board. Only the final commit
 * (closing the board) asks for it: reloading means the webview decodes the
 * whole SVG again, behind the board, after every debounced save.
 */
export function saveBoardFile(absolute: string, scene: BoardScene, refresh = true): Promise<void> {
  const prev = chains.get(absolute) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      const text = await boardFileText(scene, getParentDir(absolute));
      if (lastText.get(absolute) !== text) {
        await tauri.writeFile(absolute, text);
        lastText.set(absolute, text);
        versions.set(absolute, (versions.get(absolute) ?? 0) + 1);
        stalePreviews.add(absolute);
      }
      if (refresh && stalePreviews.delete(absolute)) refreshPreviews(absolute);
    })
    .catch((error) => {
      console.error(`[board] could not save ${absolute}`, error);
      throw error;
    });
  chains.set(
    absolute,
    next.catch(() => undefined),
  );
  return next;
}

function previewSrc(absolute: string): string {
  const version = versions.get(absolute);
  const base = convertFileSrc(absolute);
  return version ? `${base}?v=${version}` : base;
}

function refreshPreviews(absolute: string): void {
  dropRestyled(absolute);
  setPreviews(absolute, previewSrc(absolute));
}

function setPreviews(absolute: string, src: string): void {
  for (const img of document.querySelectorAll<HTMLImageElement>("img[data-board-path]")) {
    if (img.dataset.boardPath === absolute) img.src = src;
  }
}

/**
 * Previews of board files saved before the current colours: a Blob URL of
 * the file with today's `<style>` swapped in (`withCurrentStyle`), or null
 * when its style is already current. One read per file, shared by every
 * `<img>` that shows it. The file on disk is not touched; its next save
 * writes the current style, and `refreshPreviews` drops the entry.
 */
const restyled = new Map<string, Promise<string | null>>();

function dropRestyled(absolute: string): void {
  const pending = restyled.get(absolute);
  if (!pending) return;
  restyled.delete(absolute);
  void pending.then((url) => {
    if (url) URL.revokeObjectURL(url);
  });
}

/** Shows `image`, and every other preview of the file, in the current colours
 *  when the file was saved with older ones. Only for files not written this
 *  session: those already carry the current style. */
function showRestyled(absolute: string, image: HTMLImageElement): void {
  let pending = restyled.get(absolute);
  if (!pending) {
    const version = versions.get(absolute);
    pending = tauri
      .readFile(absolute)
      .then((file) => {
        // Saved while it was being read: the new file is already current.
        if (versions.get(absolute) !== version) return null;
        const text = withCurrentStyle(file.content);
        if (text === null) return null;
        return URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
      })
      .catch((error: unknown) => {
        // The plain file preview stays; a later preview of it tries again.
        console.error(`[board] could not read ${absolute} to restyle its preview`, error);
        restyled.delete(absolute);
        return null;
      });
    restyled.set(absolute, pending);
  }
  void pending.then((url) => {
    if (!url || versions.has(absolute) || restyled.get(absolute) !== pending) return;
    // The image may not be in the document yet, so set it as well as the rest.
    image.src = url;
    setPreviews(absolute, url);
  });
}

/* -------------------------------------------------------------- create */

/**
 * Creates a board file in the note's assets folder and returns its path
 * relative to the note. Picture paths in `scene` are relative to `srcDir` and
 * get rebased onto the new file's folder, which is only known once Rust has
 * named it — hence the placeholder write first.
 */
export async function createBoardFile(
  notePath: string,
  scene: BoardScene = emptyScene(),
  srcDir: string = getParentDir(notePath),
): Promise<{ relative: string; absolute: string }> {
  const placeholder = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const saved = await tauri.saveClipboardImage(notePath, Array.from(placeholder), "board.svg");
  const svgDir = getParentDir(saved.absolute_path);
  for (const el of scene.els) {
    if (el.t === "image" && el.src && !PASSTHROUGH.test(el.src)) {
      el.src = relativePath(svgDir, absoluteFrom(srcDir, el.src));
    }
  }
  await saveBoardFile(saved.absolute_path, scene);
  return { relative: saved.relative_path, absolute: saved.absolute_path };
}

/** A board file built from a Mermaid diagram, centred on the origin. */
export async function createBoardFromMermaid(
  notePath: string,
  source: string,
): Promise<{ relative: string; absolute: string }> {
  const els = mermaidToElements(source, measureText);
  if (!els) throw new Error("Only Mermaid flowcharts and mind maps can become boards.");
  const scene = emptyScene();
  scene.els = els;
  return createBoardFile(notePath, scene);
}

/* ---------------------------------------------------------------- open */

export interface OpenBoardMode {
  /** Straight into present mode; leaving it closes the board. */
  present?: boolean;
  /** Open over this element (the note's page) instead of full screen. */
  inline?: HTMLElement;
  onClosed?: () => void;
}

export async function openBoardFile(
  absolute: string,
  notePath: string | null,
  { present = false, inline, onClosed }: OpenBoardMode = {},
): Promise<{ close: () => void }> {
  const file = await tauri.readFile(absolute);
  const parsed = readBoardSvg(file.content);
  if (!parsed) throw new Error("This SVG has no Pensée board inside it.");
  lastText.set(absolute, file.content);
  const dir = getParentDir(absolute);
  const highlights = bookLinkSync(parsed.scene, notePath);
  return openBoardFullscreen({
    scene: parsed.scene,
    resolveSrc: editorResolver(dir),
    importImage: importerFor(notePath, dir),
    onCommit: (scene) => {
      highlights.sync(scene);
      void saveBoardFile(absolute, scene, false);
    },
    onFinalCommit: (scene) => {
      highlights.sync(scene);
      void saveBoardFile(absolute, scene);
    },
    present,
    inline,
    onClosed,
    exportSvg: (scene) => boardFileText(scene, dir),
    notePath,
    onOpened: ({ warn }) => {
      if (parsed.badLines > 0) warn(`${parsed.badLines} element(s) could not be read`);
    },
  });
}

/* ------------------------------------------------- in-note preview hook */

function cardButton(label: string, onOpen: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wr-board-image-open";
  btn.textContent = label;
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onOpen();
  });
  return btn;
}

/** The board open over each note's page. It lives as long as the note's
 *  editor, not the preview widget: the widget is redrawn whenever the page is
 *  edited (a highlight added from a book beside it, say), the page is not. */
const pageBoards = new WeakMap<EditorView, { close: () => void }>();

const pageBoardLifetime = ViewPlugin.define((view) => ({
  destroy: () => pageBoards.get(view)?.close(),
}));

/** Turns a `.board.svg` image preview into an openable board. The picture
 *  itself is still the plain `<img>` — that is what makes it instant. */
export function boardImageEnhancer(getFilePath: () => string | null) {
  return [
    pageBoardLifetime,
    imageWidgetEnhancerFacet.of((dom, image, url, view: EditorView) => {
      if (!isBoardFile(url)) return;
      const notePath = getFilePath();
      if (!notePath) return;
      const absolute = absoluteFrom(getParentDir(notePath), url);
      image.dataset.boardPath = absolute;
      if (versions.has(absolute)) image.src = previewSrc(absolute);
      else showRestyled(absolute, image);
      dom.classList.add("wr-board-image");
      prefetchBoardChrome();
      image.title = "Open board";

      const open = (mode: OpenBoardMode = {}): void => {
        dom.querySelector(".wr-board-image-error")?.remove();
        openBoardFile(absolute, getFilePath(), mode)
          .then((board) => {
            if (!mode.inline) return;
            // The note closed while the file was being read.
            if (!mode.inline.isConnected) return board.close();
            pageBoards.set(view, board);
          })
          .catch((error: unknown) => {
            const note = document.createElement("span");
            note.className = "wr-board-image-error";
            note.textContent = `Couldn't open board: ${error instanceof Error ? error.message : String(error)}`;
            dom.append(note);
          });
      };
      const actions = document.createElement("span");
      actions.className = "wr-board-image-actions";
      // Present straight from the note: the board opens full-screen as slides.
      actions.append(
        cardButton("Present", () => open({ present: true })),
        cardButton("Edit here", () => {
          const page = view.dom.closest<HTMLElement>("[data-pane]");
          if (!page) return open();
          open({ inline: page, onClosed: () => pageBoards.delete(view) });
        }),
        cardButton("Open board", () => open()),
      );
      dom.append(actions);
      image.addEventListener("click", (e) => {
        e.preventDefault();
        open();
      });
    }),
  ];
}
