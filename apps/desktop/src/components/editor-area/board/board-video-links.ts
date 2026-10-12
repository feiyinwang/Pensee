/**
 * Video pins on a board (SPECs/youtube-notes-spec.md#pins-on-a-board).
 *
 * A rectangle or mind-map node pinned while a YouTube note's video played
 * carries `ln` = `Page#^yt-<seconds>`: the video note's name and the moment.
 * The time is in the link itself, so nothing on the page backs it and
 * deleting the element deletes nothing else.
 */

import * as editorApi from "@/hooks/editor-api";
import { getWorkspaceRoot } from "@/hooks/workspace-api";
import { seekVideo } from "@/lib/video-players";
import { parseVideoLink } from "@/lib/video-pins";
import { findWikiPage } from "@/lib/wiki-pages";
import { showEditorNotice } from "../editor-notice-store";
import { tauriWikiPageDeps } from "../wiki-pages-extension";

/** Plays the pinned moment in its note's player, opening the note beside
 *  first when it is not open. */
export async function openVideoLink(inner: string, fromPath: string | null): Promise<void> {
  const link = parseVideoLink(inner);
  const root = getWorkspaceRoot();
  const path =
    link && root ? await findWikiPage(link.page, root, fromPath, tauriWikiPageDeps) : null;
  if (!link || !path) {
    showEditorNotice(`Couldn't find the video note "${link?.page ?? inner}".`);
    return;
  }
  // Waits for the player when the note is still opening.
  const played = seekVideo(path, link.seconds);
  if (!played || !editorApi.isFileOpenInTab(path)) void editorApi.openLinkedPage(path);
}
