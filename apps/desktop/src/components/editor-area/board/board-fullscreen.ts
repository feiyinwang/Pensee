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
 */

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
  /** Lets the host tell us the document changed underneath us. */
  onOpened?: (api: { warn: (message: string) => void; close: () => void }) => void;
}

const COMMIT_DEBOUNCE_MS = 600;

let openInstance: { close: () => void } | null = null;

export function isBoardOpen(): boolean {
  return openInstance !== null;
}

export function closeOpenBoard(): void {
  openInstance?.close();
}

export function openBoardFullscreen(opts: BoardFullscreenOptions): { close: () => void } {
  // Single instance: double-clicking a preview card must not stack overlays.
  if (openInstance) return openInstance;

  const overlay = document.createElement("div");
  overlay.className = "wr-board-fullscreen";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Board");
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

    overlay.classList.remove("is-open");
    let removed = false;
    const finalize = (): void => {
      if (removed) return;
      removed = true;
      overlay.remove();
    };
    stage.addEventListener("transitionend", finalize, { once: true });
    // Slightly longer than --motion-base so a normal exit fires transitionend first.
    setTimeout(finalize, 200);
  };

  /** Capture phase so Esc, ⌘Z, ⌘F never reach the editor behind the overlay.
   *  The board's own handlers run on the host element inside. */
  const SWALLOWED = new Set(["f", "p", "k", "s"]);
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!overlay.isConnected) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && SWALLOWED.has(e.key.toLowerCase())) {
      e.preventDefault();
      e.stopPropagation();
      // ⌘F stays out of the note behind, but is the board's own find.
      if (e.key.toLowerCase() === "f") canvas?.find();
      return;
    }
    if (mod && e.key.toLowerCase() === "z") {
      // Belongs to the board's stack; stop it from reaching CodeMirror.
      e.stopPropagation();
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

  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) close();
  });

  document.body.append(overlay);

  canvas = mountBoardCanvas(stage, {
    scene: opts.scene,
    onChange: scheduleCommit,
    onClose: close,
    resolveSrc: opts.resolveSrc,
    importImage: opts.importImage,
    present: opts.present,
    exportSvg: opts.exportSvg,
  });

  void overlay.getBoundingClientRect();
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  canvas.focus();

  openInstance = { close };
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
