import { youtubeStartSeconds } from "./covers";
import * as tauri from "./tauri";

// The YouTube players mounted in this window (SPECs/youtube-notes-spec.md),
// by the note they play. A plain registry like `book-readers.ts`: nothing
// renders from it. Pins ask it to seek, the pin shortcut asks it for the
// time, and a seek asked for before the note is open waits here for its
// player.

export interface VideoPlayer {
  notePath: string;
  /** Where the video is now, in seconds (estimated between reports). */
  time: () => number;
  /** Play from `seconds`. */
  seek: (seconds: number) => void;
  /** Pause if playing, else play. */
  toggle: () => void;
  /** Whether it is playing now (as last reported). */
  playing: () => boolean;
  /** One step slower (-1) or faster (1) on YouTube's speed list. */
  speed: (step: -1 | 1) => void;
  /** Jump `seconds` back (negative) or on, playing or paused as it was.
   *  YouTube players only: ← / → while the pointer is over the video. */
  skip?: (seconds: number) => void;
  /** Saves the picture showing now into the note's assets folder; returns
   *  its path relative to the note. YouTube players only (⌘⇧S). */
  picture?: () => Promise<string>;
  /** The player on screen, for placing a pin's card beside it on a board. */
  rect: () => DOMRect;
  /** Whether it is on screen: an inactive tab keeps its player mounted but
   *  hidden. */
  shown: () => boolean;
}

/** By note; more than one when the note is open in more than one tab. */
const players = new Map<string, VideoPlayer[]>();
const pendingSeeks = new Map<string, number>();
/** The note whose player was last played or pinned from: the one the pin
 *  shortcut means when focus is not in a video's own note. */
let lastUsed: string | null = null;
/** The player under the pointer, as its page reports: ← / → skip it and
 *  ⇧, / ⇧. change its speed. */
let hovered: VideoPlayer | null = null;

export function registerVideoPlayer(player: VideoPlayer): () => void {
  players.set(player.notePath, [...(players.get(player.notePath) ?? []), player]);
  const pending = pendingSeeks.get(player.notePath);
  if (pending !== undefined) {
    pendingSeeks.delete(player.notePath);
    player.seek(pending);
    lastUsed = player.notePath;
  }
  return () => {
    if (hovered === player) hovered = null;
    const rest = (players.get(player.notePath) ?? []).filter((p) => p !== player);
    if (rest.length > 0) players.set(player.notePath, rest);
    else players.delete(player.notePath);
  };
}

/** `notePath`'s player: the one on screen, else the newest. */
export function videoPlayerFor(notePath: string): VideoPlayer | null {
  const list = [...(players.get(notePath) ?? [])].reverse();
  return list.find((p) => p.shown()) ?? list[0] ?? null;
}

export function markVideoUsed(notePath: string): void {
  lastUsed = notePath;
}

/**
 * The player the shortcuts mean when focus is in no video's note: the last
 * one used if it is on screen, else the only note's video on screen (a note
 * just picked in the sidebar or tab bar), else the last one used even in a
 * hidden tab, else the only one.
 */
export function currentVideoPlayer(): VideoPlayer | null {
  const last = lastUsed ? videoPlayerFor(lastUsed) : null;
  if (last?.shown()) return last;
  const shown = [...players.keys()].filter((path) => videoPlayerFor(path)!.shown());
  if (shown.length === 1) return videoPlayerFor(shown[0]!);
  if (last) return last;
  return players.size === 1 ? videoPlayerFor([...players.keys()][0]!) : null;
}

export function setVideoHovered(player: VideoPlayer, over: boolean): void {
  if (over) hovered = player;
  else if (hovered === player) hovered = null;
}

/** The player the pointer is over, if it is on screen. */
export function hoveredVideoPlayer(): VideoPlayer | null {
  return hovered?.shown() ? hovered : null;
}

export function hasVideoPlayers(): boolean {
  return players.size > 0;
}

/** Play `notePath`'s video from `seconds` now if its player is mounted, else
 *  once it mounts. Returns whether it played now. */
export function seekVideo(notePath: string, seconds: number): boolean {
  const player = videoPlayerFor(notePath);
  if (!player) {
    pendingSeeks.set(notePath, seconds);
    return false;
  }
  lastUsed = notePath;
  player.seek(seconds);
  return true;
}

/** A link to `notePath`'s video pasted again with a time (`…&t=210`): play
 *  it from there, as YouTube would. Nothing for a link without one. */
export function seekVideoToLinkTime(notePath: string, address: string): void {
  const seconds = youtubeStartSeconds(address);
  if (seconds > 0) seekVideo(notePath, seconds);
}

/** How long after a pause the first words typed in the note still count as
 *  a note on that moment. */
export const AUTO_PIN_WINDOW_MS = 15_000;
/** An auto pin lands this far before the pause: by the time a thought makes
 *  you stop the video, the moment it was about has passed. */
export const AUTO_PIN_LEAD_SECONDS = 5;

let armed: { notePath: string; seconds: number; at: number } | null = null;

/** The video in `notePath` paused at `seconds`: the next words typed in that
 *  note, if soon, get a pin a little before it. */
export function armAutoPin(notePath: string, seconds: number, now = performance.now()): void {
  armed = { notePath, seconds: Math.max(0, seconds - AUTO_PIN_LEAD_SECONDS), at: now };
}

export function disarmAutoPin(): void {
  armed = null;
}

/** The second to pin when typing in `notePath` now, or null when no pause
 *  there is recent enough. Doesn't disarm: the caller does once it acted. */
export function autoPinFor(notePath: string, now = performance.now()): number | null {
  if (!armed || armed.notePath !== notePath) return null;
  if (now - armed.at > AUTO_PIN_WINDOW_MS) {
    armed = null;
    return null;
  }
  return armed.seconds;
}

let origin: Promise<string> | null = null;

/** The loopback page's origin (`http://127.0.0.1:<port>`): YouTube plays
 *  only for an embed with an http referrer, which `tauri://` is not. */
export function videoPlayerOrigin(): Promise<string> {
  origin ??= tauri.videoPlayerOrigin().catch((error: unknown) => {
    origin = null;
    throw error;
  });
  return origin;
}
