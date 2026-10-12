import { youtubeTranscript } from "@/lib/tauri";
import { videoIdOf } from "@/lib/video-pins";
import { hasTranscript, transcriptBlock } from "@/lib/video-transcript";
import { useEditorStore } from "@/stores/editor-store";
import { showEditorNotice } from "./editor-notice-store";
import { liveEditorsFor } from "./linked-block-sync";

// Bringing a video's transcript into its note
// (SPECs/youtube-notes-spec.md#transcript): a closed toggle at the top of the
// body, right under the properties and the player.

/** One read per note at a time; a second ask waits on the first. */
const reads = new Map<string, Promise<void>>();

/** Reads `videoId`'s transcript and puts it at the top of `notePath`'s body,
 *  unless the note already has one. */
export function bringInTranscript(notePath: string, videoId: string): Promise<void> {
  const running = reads.get(notePath);
  if (running) return running;
  const file = useEditorStore.getState().openFiles.get(notePath);
  if (file && hasTranscript(file.content)) return Promise.resolve();
  const read = readAndInsert(notePath, videoId).finally(() => reads.delete(notePath));
  reads.set(notePath, read);
  return read;
}

async function readAndInsert(notePath: string, videoId: string): Promise<void> {
  let cues: Awaited<ReturnType<typeof youtubeTranscript>>;
  try {
    cues = await youtubeTranscript(videoId);
  } catch (error) {
    console.error(`[video] Couldn't read the transcript of ${videoId}:`, error);
    showEditorNotice("Couldn't get the video's transcript.");
    return;
  }
  if (!cues.length) {
    showEditorNotice("This video has no transcript.");
    return;
  }
  // The link may have changed while the transcript was read.
  const frontmatter = useEditorStore.getState().openFiles.get(notePath)?.frontmatter ?? null;
  if (videoIdOf(frontmatter) !== videoId) return;
  const [view] = liveEditorsFor(notePath);
  if (!view) {
    console.error(`[video] No open editor for ${notePath} to put the transcript in`);
    showEditorNotice("Couldn't find the video's note to put the transcript in.");
    return;
  }
  if (hasTranscript(view.state.doc.toString())) return;
  const block = transcriptBlock(cues);
  view.dispatch({
    changes: { from: 0, insert: view.state.doc.length ? `${block}\n\n` : `${block}\n` },
    userEvent: "input.video-transcript",
  });
}
