import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

import { blockIdsInText, blockIdOnLine } from "@/lib/block-refs";
import {
  PIN_ICON_PATH,
  formatVideoTime,
  isBlankLine,
  pinEmptyLine,
  pinnedItemAfter,
  videoLinkTarget,
  videoPinId,
} from "@/lib/video-pins";
import {
  type VideoPlayer,
  autoPinFor,
  currentVideoPlayer,
  disarmAutoPin,
  hasVideoPlayers,
  hoveredVideoPlayer,
  markVideoUsed,
  seekVideo,
  videoPlayerFor,
} from "@/lib/video-players";
import { blockIdLine, canCarryBlockId, gripBlockAt } from "./block-actions";
import { addPinToOpenBoard, boardHasFocus } from "./board/board-fullscreen";
import { showEditorNotice } from "./editor-notice-store";
import { blockEmbedHost, liveEditorsFor } from "./linked-block-sync";

// Pins on a YouTube note (SPECs/youtube-notes-spec.md): the `^yt-<seconds>`
// id drawn as a pin that plays from that moment, and ⌘S / **Pin**, which
// stamps the block at the caret with the video's time — or, with a board open
// over a page, adds the moment to the board.

const SVG_NS = "http://www.w3.org/2000/svg";

/** The pin icon, shared by video pins and book pins (book-jump.ts). */
export function pinIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", PIN_ICON_PATH);
  svg.append(path);
  return svg;
}

/** The pin drawn in place of a `^yt-…` id. Atomic (block-embed.ts puts it in
 *  the editor's atomic ranges), so Backspace after it removes the pin whole. */
export class VideoPinWidget extends WidgetType {
  constructor(
    readonly seconds: number,
    readonly getFilePath: () => string,
  ) {
    super();
  }

  eq(other: VideoPinWidget): boolean {
    return other.seconds === this.seconds;
  }

  toDOM(): HTMLElement {
    const pin = document.createElement("span");
    pin.className = "cm-video-pin";
    pin.setAttribute("role", "button");
    const label = `Play from ${formatVideoTime(this.seconds)}`;
    pin.title = label;
    pin.setAttribute("aria-label", label);
    pin.append(pinIcon());
    // The caret stays where it was: a pin is pressed, not clicked into.
    pin.addEventListener("mousedown", (event) => event.preventDefault());
    pin.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const notePath = this.getFilePath();
      if (!seekVideo(notePath, this.seconds)) {
        showEditorNotice(
          "This note's video or episode isn't loaded. Check its link in the properties.",
        );
      }
    });
    return pin;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Stamps the block at the caret with a pin at `seconds`, in one dispatch:
 *
 * - an empty line or empty item becomes the pinned item;
 * - a block with text and no id gets the pin;
 * - a block that already has an id gets a new pinned item after it.
 *
 * The caret ends on the pinned line, ready to type.
 */
export function pinAtCaret(view: EditorView, seconds: number): void {
  const { state } = view;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const id = videoPinId(seconds, new Set(blockIdsInText(state.doc.toString())));

  const empty = pinEmptyLine(line.text, id);
  if (empty) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: empty.text },
      selection: { anchor: line.from + empty.caret },
      userEvent: "input.video-pin",
      scrollIntoView: true,
    });
    view.focus();
    return;
  }

  const block = gripBlockAt(state, head);
  if (!block || !canCarryBlockId(block.name)) {
    showEditorNotice("Pins go on text, not on code, tables or columns.");
    return;
  }
  const idLine = blockIdLine(state, block);
  if (!blockIdOnLine(idLine.text)) {
    view.dispatch({
      changes: { from: idLine.to, insert: ` ^${id}` },
      selection: { anchor: Math.min(head, idLine.to) },
      userEvent: "input.video-pin",
      scrollIntoView: true,
    });
    view.focus();
    return;
  }
  // After the whole block: a list item with its children, a paragraph to
  // its last line (the caret narrowed it to one).
  const end =
    block.name === "ListItem" ? state.doc.lineAt(Math.max(block.from, block.to - 1)).to : idLine.to;
  const item = pinnedItemAfter(state.doc.lineAt(block.from).text, id);
  view.dispatch({
    changes: { from: end, insert: `\n${item.text}` },
    selection: { anchor: end + 1 + item.caret },
    userEvent: "input.video-pin",
    scrollIntoView: true,
  });
  view.focus();
}

/** The note a focused main editor shows, or null. */
function focusedNote(): { view: EditorView; path: string } | null {
  const active = document.activeElement;
  const dom = active instanceof HTMLElement ? active.closest<HTMLElement>(".cm-editor") : null;
  const view = dom ? EditorView.findFromDOM(dom) : null;
  const path = view?.state.facet(blockEmbedHost)?.() ?? null;
  return view && path ? { view, path } : null;
}

/**
 * Pins the moment playing now (SPECs/youtube-notes-spec.md#pins-on-a-board).
 * The video is `prefer`'s, else the focused note's, else `currentVideoPlayer`'s.
 * Focus on a board sends the pin there; focus in the video's own note puts it
 * at the caret; from anywhere else it goes to a board on screen, or else the
 * note.
 */
export function pinMoment(prefer?: VideoPlayer): void {
  const focused = focusedNote();
  const own = focused ? videoPlayerFor(focused.path) : null;
  const player = prefer ?? own ?? currentVideoPlayer();
  if (!player) {
    showEditorNotice("Play a video or podcast in a note to pin a moment.");
    return;
  }
  markVideoUsed(player.notePath);
  const seconds = player.time();
  const link = videoLinkTarget(player.notePath, seconds);
  if (boardHasFocus() && addPinToOpenBoard(link, player.rect())) return;
  if (focused && focused.path === player.notePath) {
    pinAtCaret(focused.view, seconds);
    return;
  }
  if (addPinToOpenBoard(link, player.rect())) return;
  const [view] = liveEditorsFor(player.notePath);
  if (!view) {
    showEditorNotice("Couldn't find the video's note to pin in.");
    return;
  }
  pinAtCaret(view, seconds);
}

/**
 * ⌘S, "save the moment": while the video plays, pins the moment and pauses,
 * so you can write about it; while it is paused, plays on. One key for the
 * listen → pin → write loop (SPECs/obsidian-shortcuts-spec.md#the-system).
 * The video is the focused note's, else `currentVideoPlayer`'s.
 */
export function saveTheMoment(): void {
  const focused = focusedNote();
  const player = (focused && videoPlayerFor(focused.path)) ?? currentVideoPlayer();
  if (!player) {
    showEditorNotice("Play a video or podcast in a note to pin a moment.");
    return;
  }
  if (!player.playing()) {
    player.toggle();
    return;
  }
  pinMoment(player);
  player.toggle();
}

/**
 * Words typed into a video's note soon after it paused are a note on that
 * moment: the block they land in gets a pin a few seconds before the pause
 * (AUTO_PIN_LEAD_SECONDS), as if ⌘S had been pressed then. Waits for words,
 * so a bullet marker alone doesn't pin, and for an IME composition to end.
 * A block that already has an id keeps it.
 */
export function videoAutoPin(getFilePath: () => string): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {}

      update(update: ViewUpdate): void {
        if (!update.docChanged || autoPinFor(getFilePath()) === null) return;
        if (!update.transactions.some((tr) => tr.isUserEvent("input.type"))) return;
        // No dispatch inside an update.
        if (!update.view.composing) queueMicrotask(() => autoPinAtCaret(this.view, getFilePath()));
      }
    },
    {
      eventHandlers: {
        compositionend() {
          // The composed text lands after the event.
          setTimeout(() => autoPinAtCaret(this.view, getFilePath()), 0);
        },
      },
    },
  );
}

function autoPinAtCaret(view: EditorView, notePath: string): void {
  if (view.composing) return;
  const seconds = autoPinFor(notePath);
  if (seconds === null) return;
  const { state } = view;
  const { head, empty } = state.selection.main;
  if (!empty || isBlankLine(state.doc.lineAt(head).text)) return;
  disarmAutoPin();
  const block = gripBlockAt(state, head);
  if (!block || !canCarryBlockId(block.name)) return;
  const idLine = blockIdLine(state, block);
  if (blockIdOnLine(idLine.text)) return;
  const id = videoPinId(seconds, new Set(blockIdsInText(state.doc.toString())));
  view.dispatch({
    changes: { from: idLine.to, insert: ` ^${id}` },
    // The caret stays before the pin, mid-word.
    selection: { anchor: head },
    userEvent: "input.video-pin",
  });
}

export const PIN_SHORTCUT_LABEL = "⌘S";
export const SLOWER_SHORTCUT_LABEL = "⇧,";
export const FASTER_SHORTCUT_LABEL = "⇧.";
export const SPEED_KEYSHORTCUTS = "Shift+, Shift+.";
/** How far ← / → jump the video under the pointer, as on YouTube. */
export const SKIP_SECONDS = 5;

/** -1 / 1 for a bare ← / →, or null for any other key. */
function skipStep(event: KeyboardEvent): -1 | 1 | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.key === "ArrowLeft") return -1;
  if (event.key === "ArrowRight") return 1;
  return null;
}

/** -1 / 1 for slower / faster, or null for any other key. By character (`<`
 *  `>`, their own key on some layouts) or by key with Shift (⇧, ⇧. — what an
 *  input source such as Pinyin, which types 《 》 there, still presses). */
function speedStep(event: KeyboardEvent): -1 | 1 | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === "<" || (event.shiftKey && event.code === "Comma")) return -1;
  if (event.key === ">" || (event.shiftKey && event.code === "Period")) return 1;
  return null;
}

let installed = false;
/** Last element focused outside a player, so starting a video by clicking in
 *  it can hand focus straight back (typing goes to the note, not YouTube). */
let lastFocus: HTMLElement | null = null;

/** Whether ⌘S pins the moment here: in a note that plays a video or
 *  episode, on its player, or on a board while one is mounted (a board
 *  swallows ⌘S anyway). Everywhere else ⌘S does nothing. */
function pinKeyHere(): boolean {
  const focused = focusedNote();
  if (focused) return videoPlayerFor(focused.path) !== null;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest(".video-band, .podcast-card")) return true;
  return boardHasFocus() && currentVideoPlayer() !== null;
}

/** ⌘S (pin and pause, or play on) where `pinKeyHere`, ← / → (skip) and ⇧, /
 *  ⇧. (speed) while the pointer is over a player, and the focus tracking
 *  `returnFocus` needs. Installed once, by the first player. */
export function installVideoPinShortcut(): void {
  if (installed) return;
  installed = true;
  document.addEventListener(
    "keydown",
    (event) => {
      if (!hasVideoPlayers() || event.isComposing) return;
      // Over a video ← / → move it, not the caret, wherever focus is.
      const skip = skipStep(event);
      if (skip !== null) {
        const player = hoveredVideoPlayer();
        if (!player?.skip) return;
        event.preventDefault();
        event.stopPropagation();
        player.skip(skip * SKIP_SECONDS);
        return;
      }
      // Over a player ⇧, / ⇧. change its speed; off it they type.
      const step = speedStep(event);
      if (step !== null) {
        const player = hoveredVideoPlayer();
        if (!player) return;
        event.preventDefault();
        event.stopPropagation();
        player.speed(step);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (!event.shiftKey && event.key.toLowerCase() === "s") {
        if (!pinKeyHere()) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) saveTheMoment();
      }
    },
    // Capture: before the board's and the editor's own keys.
    true,
  );
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement && !(event.target instanceof HTMLIFrameElement)) {
      lastFocus = event.target;
    }
  });
}

/** Gives focus back to where it was before `frame` took it. */
export function returnFocusFrom(frame: HTMLIFrameElement): void {
  if (document.activeElement !== frame) return;
  if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
}
