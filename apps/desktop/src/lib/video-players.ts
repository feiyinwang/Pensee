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
  /** The player on screen, for placing a pin's card beside it on a board. */
  rect: () => DOMRect;
}

const players = new Map<string, VideoPlayer>();
const pendingSeeks = new Map<string, number>();
/** The note whose player was last played or pinned from: the one the pin
 *  shortcut means when focus is not in a video's own note. */
let lastUsed: string | null = null;

export function registerVideoPlayer(player: VideoPlayer): () => void {
  players.set(player.notePath, player);
  const pending = pendingSeeks.get(player.notePath);
  if (pending !== undefined) {
    pendingSeeks.delete(player.notePath);
    player.seek(pending);
    lastUsed = player.notePath;
  }
  return () => {
    if (players.get(player.notePath) === player) players.delete(player.notePath);
  };
}

export function videoPlayerFor(notePath: string): VideoPlayer | null {
  return players.get(notePath) ?? null;
}

export function markVideoUsed(notePath: string): void {
  lastUsed = notePath;
}

/** The player the pin shortcut uses when focus is in no video's note. */
export function lastUsedVideoPlayer(): VideoPlayer | null {
  const last = lastUsed ? players.get(lastUsed) : undefined;
  if (last) return last;
  return players.size === 1 ? [...players.values()][0]! : null;
}

export function hasVideoPlayers(): boolean {
  return players.size > 0;
}

/** Play `notePath`'s video from `seconds` now if its player is mounted, else
 *  once it mounts. Returns whether it played now. */
export function seekVideo(notePath: string, seconds: number): boolean {
  const player = players.get(notePath);
  if (!player) {
    pendingSeeks.set(notePath, seconds);
    return false;
  }
  lastUsed = notePath;
  player.seek(seconds);
  return true;
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
