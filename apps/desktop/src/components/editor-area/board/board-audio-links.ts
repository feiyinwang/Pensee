/**
 * Audio clips on a board (SPECs/talk-notes-spec.md#topic-boards). A node a
 * talk drew carries `ln` = `Recordings/<take>#t=<start>,<end>`; its corner
 * badge plays only that part of the take. The clip is in the link itself, so
 * deleting the node deletes nothing else.
 */

import { getWorkspaceRoot } from "@/hooks/workspace-api";
import { parseAudioClip } from "@/lib/audio-clips";
import { playClip } from "@/lib/clip-player";
import { showEditorNotice } from "../editor-notice-store";
import type { BoardScene } from "./board-model";

/** Plays a node's clip; false when `inner` isn't a clip. */
export function playAudioClipLink(inner: string): boolean {
  const clip = parseAudioClip(inner);
  if (!clip) return false;
  const root = getWorkspaceRoot();
  if (!root) {
    showEditorNotice("Open a workspace to play this clip.");
    return true;
  }
  playClip(`${root}/${clip.path}`, clip.start, clip.end);
  return true;
}

/** Radius of a pin badge (board-render.ts appendPinBadge), plus room for a finger. */
const BADGE_HIT = 14;

/** The clip whose badge is at scene point (x, y): badges sit on a node's top-right corner. */
export function audioClipAt(scene: BoardScene, x: number, y: number): string | null {
  for (let i = scene.els.length - 1; i >= 0; i--) {
    const el = scene.els[i]!;
    const ln = "ln" in el ? (el as { ln?: string }).ln : undefined;
    if (!ln || !parseAudioClip(ln)) continue;
    if (Math.hypot(x - (el.x + el.w), y - el.y) <= BADGE_HIT) return ln;
  }
  return null;
}
