/**
 * Full-screen board overlay.
 *
 * Structure copied deliberately from `mermaid-fullscreen.ts`: a plain fixed div
 * on `document.body` (not `<dialog>`), Esc handled in the capture phase, focus
 * saved and restored, exit animation with a timeout fallback. That file already
 * paid for these lessons.
 *
 * Living outside the editor's `contentDOM` is also what makes the board's
 * keyboard handling simple — there is no CodeMirror keymap above us to fight.
 *
 * `inline` mounts the same board over one note's page instead (its pane, not
 * the window): the note's tab row, the other columns and a book beside it
 * stay usable. While one is open and on screen, highlights made in a book
 * land on it as linked rectangles (`addHighlightToOpenBoard`), and so do pins
 * from a YouTube note's player (`addPinToOpenBoard`).
 */

import * as editorApi from "@/hooks/editor-api";
import { followWikiLink } from "../wiki-pages-extension";
import { parseVideoLink } from "@/lib/video-pins";
import { openBookLink, parseBookLink } from "./board-book-links";
import { openVideoLink } from "./board-video-links";
import { type BoardScene, cloneScene } from "./board-model";
import { type BoardCanvasHandle, mountBoardCanvas } from "./board-canvas";

export interface BoardFullscreenOptions {
  scene: BoardScene;
  /** Debounced write-back while editing. */
  onCommit: (scene: BoardScene) => void;
  /** Final write on close — always fires, even if the debounce is pending. */
  onFinalCommit: (scene: BoardScene) => void;
  resolveSrc: (src: string) => string;
  importImage?: (file: File) => Promise<{ src: string; w: number; h: number } | null>;
  /** Open straight into present mode; leaving it closes the board. */
  present?: boolean;
  exportSvg?: (scene: BoardScene) => Promise<string>;
  /** The note the board belongs to: `[[links]]` in cards resolve from it. */
  notePath?: string | null;
  /** Lets the host tell us the document changed underneath us. */
  onOpened?: (api: { warn: (message: string) => void; close: () => void }) => void;
  /** Open over this element (the note's page) instead of the whole window. */
  inline?: HTMLElement;
  /** After the board is gone (and written back). */
  onClosed?: () => void;
}

const COMMIT_DEBOUNCE_MS = 600;

let openInstance: {
  close: () => void;
  inline: boolean;
  notePath: string | null;
  canvas: () => BoardCanvasHandle | null;
  overlay: HTMLElement;
} | null = null;

export function isBoardOpen(): boolean {
  return openInstance !== null;
}

export function closeOpenBoard(): void {
  openInstance?.close();
}

/** The board open over a page, when it is on screen: open in a tab that is
 *  not showing is not where the reader is working. */
function onScreenInlineBoard(): { canvas: BoardCanvasHandle; rect: DOMRect } | null {
  const open = openInstance;
  const canvas = open?.canvas();
  if (!open?.inline || !canvas) return null;
  const rect = open.overlay.getBoundingClientRect();
  if (!rect.width || getComputedStyle(open.overlay).visibility !== "visible") return null;
  return { canvas, rect };
}

/** The side of `board` facing `from`. */
function sideFacing(from: DOMRect, board: DOMRect): "w" | "e" {
  return from.left + from.width / 2 < board.left + board.width / 2 ? "w" : "e";
}

/**
 * Adds a book highlight to the board open over a page, when there is one on
 * screen: a rectangle labelled `text`, linking to `link`, on the side facing
 * `from` (the book). Any book counts — the board need not be on the book's
 * own page. Returns whether a board took it.
 */
export function addHighlightToOpenBoard(text: string, link: string, from: DOMRect): boolean {
  const board = onScreenInlineBoard();
  if (!board) return false;
  board.canvas.addCard(text, sideFacing(from, board.rect), link);
  return true;
}

/** Whether focus is in the board open over a page. */
export function boardHasFocus(): boolean {
  const active = document.activeElement;
  return Boolean(openInstance?.inline && active && openInstance.overlay.contains(active));
}

/**
 * Adds a video pin (`link`, `Page#^yt-…`) to the board open over a page, when
 * there is one on screen (SPECs/youtube-notes-spec.md): a child of the
 * selected mind-map node, else a rectangle on the side facing `from` (the
 * player). Typing starts in it. Returns whether a board took it.
 */
export function addPinToOpenBoard(link: string, from: DOMRect): boolean {
  const board = onScreenInlineBoard();
  if (!board) return false;
  board.canvas.addPin(link, sideFacing(from, board.rect));
  return true;
}

export function openBoardFullscreen(opts: BoardFullscreenOptions): { close: () => void } {
  if (openInstance) {
    // Single instance: double-clicking a preview card must not stack overlays.
    if (!openInstance.inline) return openInstance;
    // A board edited in a note gives way (saved) to the one asked for now.
    openInstance.close();
  }
  const inline = opts.inline ?? null;

  const overlay = document.createElement("div");
  overlay.setAttribute("aria-label", "Board");
  if (inline) {
    overlay.className = "wr-board-inline";
  } else {
    overlay.className = "wr-board-fullscreen";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
  }
  overlay.tabIndex = -1;

  const stage = document.createElement("div");
  stage.className = "wr-board-stage";
  overlay.append(stage);

  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  let canvas: BoardCanvasHandle | null = null;
  let commitTimer = -1;
  let latest: BoardScene = cloneScene(opts.scene);
  let closed = false;

  const flushCommit = (): void => {
    window.clearTimeout(commitTimer);
    commitTimer = -1;
    opts.onCommit(latest);
  };

  const scheduleCommit = (scene: BoardScene): void => {
    latest = scene;
    window.clearTimeout(commitTimer);
    commitTimer = window.setTimeout(flushCommit, COMMIT_DEBOUNCE_MS);
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    openInstance = null;
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", onWindowBlur);

    // Clear the pending debounce first, then write once — otherwise the timer
    // can fire after teardown and commit a stale scene.
    window.clearTimeout(commitTimer);
    const finalScene = canvas?.flush() ?? latest;
    opts.onFinalCommit(finalScene);

    canvas?.destroy();
    canvas = null;
    previouslyFocused?.focus({ preventScroll: true });

    if (inline) {
      // The page shows again the moment the board goes: no fade over a blank.
      overlay.remove();
      opts.onClosed?.();
      return;
    }
    overlay.classList.remove("is-open");
    let removed = false;
    const finalize = (): void => {
      if (removed) return;
      removed = true;
      overlay.remove();
      opts.onClosed?.();
    };
    stage.addEventListener("transitionend", finalize, { once: true });
    // Slightly longer than --motion-fast so a normal exit fires transitionend
    // first; with reduced motion there is no transition and this removes it.
    setTimeout(finalize, 150);
  };

  /** Capture phase so ⌘Z, ⌘F never reach the editor behind the overlay.
   *  The board's own handlers run on the host element inside. ⌘⇧F (search)
   *  and ⌘P (the palette) are app-wide and go through. */
  const SWALLOWED = new Set(["f", "k", "s"]);
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!overlay.isConnected) return;
    // In place, the board owns only keys typed into it; the note keeps its own.
    if (inline && !(e.target instanceof Node && overlay.contains(e.target))) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && SWALLOWED.has(key) && (key !== "f" || !e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      // ⌘F stays out of the note behind, but is the board's own find.
      if (key === "f") canvas?.find();
      return;
    }
    if (mod && e.key.toLowerCase() === "z") {
      // Belongs to the board's stack. From inside the overlay it goes on to
      // the board's own handler (stopping it here, in the capture phase,
      // used to starve that handler, so ⌘Z did nothing). From anywhere else
      // (focus left in the note behind) it must not reach CodeMirror: stop
      // it and undo on the board directly.
      if (e.target instanceof Node && overlay.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      canvas?.history(e.shiftKey ? "redo" : "undo");
      return;
    }
    // Escape is NOT stopped here. This listener runs in the capture phase on
    // `document`, so stopping it starved every handler inside the overlay:
    // Esc could not finish typing, clear a selection, close a popover or
    // close the board. The overlay is not inside the editor, so its key
    // events never reach CodeMirror anyway.
  };

  const onWindowBlur = (): void => {
    // Losing the window mid-edit is the classic way to lose work.
    if (commitTimer !== -1) flushCommit();
  };

  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", onWindowBlur);

  if (!inline) {
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) close();
    });
  }

  (inline ?? document.body).append(overlay);

  canvas = mountBoardCanvas(stage, {
    scene: opts.scene,
    onChange: scheduleCommit,
    onClose: close,
    resolveSrc: opts.resolveSrc,
    importImage: opts.importImage,
    present: opts.present,
    exportSvg: opts.exportSvg,
    onOpenLink: (inner) => {
      if (parseVideoLink(inner)) {
        // The player is in the video's note, beside an in-page board; full
        // screen the board would hide it, so it closes (and writes back) first.
        if (!inline) close();
        void openVideoLink(inner, opts.notePath ?? null);
        return;
      }
      if (parseBookLink(inner)) {
        // Over a page the book is beside it, so the board stays; full screen
        // it would hide the book, so it closes (and writes back) first.
        if (!inline) close();
        void openBookLink(inner, opts.notePath ?? null);
        return;
      }
      // Close first: it writes the board back, and the page opens behind it.
      close();
      followWikiLink(inner, opts.notePath ?? null)
        .then((path) => {
          if (path) void editorApi.openLinkedPage(path);
        })
        .catch((error) => console.error("[board] Failed to follow wiki link:", error));
    },
  });

  void overlay.getBoundingClientRect();
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  canvas.focus();

  openInstance = {
    close,
    inline: inline !== null,
    notePath: opts.notePath ?? null,
    canvas: () => canvas,
    overlay,
  };
  opts.onOpened?.({
    warn: (message) => {
      const el = stage.querySelector(".wr-board-banner");
      if (el instanceof HTMLElement) {
        el.textContent = message;
        el.dataset.tone = "error";
        el.hidden = false;
      }
    },
    close,
  });

  return openInstance;
}
