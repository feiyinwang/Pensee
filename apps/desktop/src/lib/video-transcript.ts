import { formatVideoTime } from "./video-pins";

// A video's transcript in its note (SPECs/youtube-notes-spec.md#transcript):
// one closed toggle under the properties, a `<details>` block whose
// paragraphs each start at a time in the video. Plain HTML, so it reads the
// same in any Markdown app. Pure: the block's text and finding one.

/** One caption line, as `youtube_transcript` reads it. */
export interface TranscriptCue {
  start: number;
  text: string;
}

/** A paragraph runs at least this long before a sentence end closes it… */
const PARAGRAPH_MIN_SECONDS = 45;
/** …and closes here anyway (automatic captions often have no full stops). */
const PARAGRAPH_MAX_SECONDS = 90;

const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const TRANSCRIPT_SUMMARY = /<summary>\s*Transcript\s*<\/summary>/i;

/** Whether a note's body already holds a transcript toggle. */
export function hasTranscript(body: string): boolean {
  return TRANSCRIPT_SUMMARY.test(body);
}

/** Cues gathered into paragraphs of about a minute, each with its start. */
export function transcriptParagraphs(cues: readonly TranscriptCue[]): TranscriptCue[] {
  const paragraphs: TranscriptCue[] = [];
  let current: { start: number; parts: string[] } | null = null;
  for (const cue of cues) {
    if (current) {
      const length = cue.start - current.start;
      const last = current.parts[current.parts.length - 1]!;
      if (
        length >= PARAGRAPH_MAX_SECONDS ||
        (length >= PARAGRAPH_MIN_SECONDS && SENTENCE_END.test(last))
      ) {
        paragraphs.push({ start: current.start, text: current.parts.join(" ") });
        current = null;
      }
    }
    if (current) current.parts.push(cue.text);
    else current = { start: cue.start, parts: [cue.text] };
  }
  if (current) paragraphs.push({ start: current.start, text: current.parts.join(" ") });
  return paragraphs;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The closed toggle holding the transcript. No blank line inside, so other
 *  Markdown apps read it as one HTML block too. */
export function transcriptBlock(cues: readonly TranscriptCue[]): string {
  const lines = transcriptParagraphs(cues).map(
    ({ start, text }) => `<p><small>${formatVideoTime(start)}</small> ${escapeHtml(text)}</p>`,
  );
  return ["<details>", "<summary>Transcript</summary>", ...lines, "</details>"].join("\n");
}
