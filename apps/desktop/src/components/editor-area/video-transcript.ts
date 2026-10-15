import { youtubeCaptionLanguages, youtubeTranscript } from "@/lib/tauri";
import { videoIdOf } from "@/lib/video-pins";
import { hasTranscript, transcriptBlock, transcriptRange } from "@/lib/video-transcript";
import { useEditorStore } from "@/stores/editor-store";
import { showEditorNotice } from "./editor-notice-store";
import { liveEditorsFor } from "./linked-block-sync";

// Bringing a video's transcript into its note
// (SPECs/youtube-notes-spec.md#transcript): a closed toggle at the top of the
// body, right under the properties and the player. English unless the video
// has no English captions; the box's language menu reads it again in another.

/** One read per note at a time; a second ask waits on the first. */
const reads = new Map<string, Promise<void>>();

/** Reads `videoId`'s transcript and puts it at the top of `notePath`'s body,
 *  unless the note already has one. */
export function bringInTranscript(notePath: string, videoId: string): Promise<void> {
  const running = reads.get(notePath);
  if (running) return running;
  const file = useEditorStore.getState().openFiles.get(notePath);
  if (file && hasTranscript(file.content)) return Promise.resolve();
  return track(notePath, readAndPut(notePath, videoId, undefined, false));
}

/** Reads the transcript again in `language` and puts it in place of the
 *  note's transcript toggle. */
export function changeTranscriptLanguage(
  notePath: string,
  videoId: string,
  language: string,
): Promise<void> {
  const running = reads.get(notePath);
  if (running) return running;
  return track(notePath, readAndPut(notePath, videoId, language, true));
}

function track(notePath: string, read: Promise<void>): Promise<void> {
  const tracked = read.finally(() => reads.delete(notePath));
  reads.set(notePath, tracked);
  return tracked;
}

/** Each video's caption languages, read once per run. */
const languageReads = new Map<string, Promise<{ code: string; name: string }[]>>();

/** The caption languages `videoId` offers, English first. A failed read is
 *  forgotten, so the next ask tries again. */
export function captionLanguagesOf(videoId: string): Promise<{ code: string; name: string }[]> {
  let read = languageReads.get(videoId);
  if (!read) {
    read = youtubeCaptionLanguages(videoId);
    read.catch(() => languageReads.delete(videoId));
    languageReads.set(videoId, read);
  }
  return read;
}

async function readAndPut(
  notePath: string,
  videoId: string,
  language: string | undefined,
  replace: boolean,
): Promise<void> {
  let transcript: Awaited<ReturnType<typeof youtubeTranscript>>;
  try {
    transcript = await youtubeTranscript(videoId, language);
  } catch (error) {
    console.error(`[video] Couldn't read the transcript of ${videoId}:`, error);
    showEditorNotice("Couldn't get the video's transcript.");
    return;
  }
  const { cues } = transcript;
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
  const block = transcriptBlock(cues, transcript.language);
  const range = transcriptRange(view.state.doc.toString());
  if (replace) {
    // The toggle may have been deleted while the transcript was read.
    if (!range) return;
    view.dispatch({ changes: { ...range, insert: block }, userEvent: "input.video-transcript" });
    return;
  }
  if (range) return;
  view.dispatch({
    changes: { from: 0, insert: view.state.doc.length ? `${block}\n\n` : `${block}\n` },
    userEvent: "input.video-transcript",
  });
}
