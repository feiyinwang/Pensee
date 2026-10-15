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
/** The whole toggle, `<details …>` to `</details>`. */
export const TRANSCRIPT_BLOCK =
  /<details(?:\s[^>]*)?>\s*<summary>\s*Transcript\s*<\/summary>[\s\S]*?<\/details\s*>/i;
const BLOCK_LANGUAGE = /^<details\s[^>]*\blang="([^"]*)"/i;

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

/** The closed toggle holding the transcript, its caption language as the
 *  HTML `lang`. No blank line inside, so other Markdown apps read it as one
 *  HTML block too. */
export function transcriptBlock(cues: readonly TranscriptCue[], language: string): string {
  const lines = transcriptParagraphs(cues).map(
    ({ start, text }) => `<p><small>${formatVideoTime(start)}</small> ${escapeHtml(text)}</p>`,
  );
  const open = `<details lang="${escapeHtml(language).replace(/"/g, "&quot;")}">`;
  return [open, "<summary>Transcript</summary>", ...lines, "</details>"].join("\n");
}

/** The transcript toggle's source in a note's body, or null. */
export function transcriptSourceIn(body: string): string | null {
  return TRANSCRIPT_BLOCK.exec(body)?.[0] ?? null;
}

/** Where the transcript toggle sits in a note's body, or null. */
export function transcriptRange(body: string): { from: number; to: number } | null {
  const match = TRANSCRIPT_BLOCK.exec(body);
  return match ? { from: match.index, to: match.index + match[0].length } : null;
}

/** The caption language of a transcript toggle (its source), or null for
 *  one written before the language was kept. */
export function transcriptLanguageIn(block: string): string | null {
  return BLOCK_LANGUAGE.exec(block.trimStart())?.[1] ?? null;
}

const TRANSCRIPT_PARAGRAPH = /<p><small>(\d+(?::\d{2}){1,2})<\/small>\s?(.*?)<\/p>/g;

function unescapeHtml(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function secondsOf(time: string): number {
  return time.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** The paragraphs of the transcript toggle in a note's body, in order: what
 *  `transcriptBlock` wrote. Empty when the note has none. */
export function transcriptIn(body: string): TranscriptCue[] {
  if (!hasTranscript(body)) return [];
  return [...body.matchAll(TRANSCRIPT_PARAGRAPH)].map((match) => ({
    start: secondsOf(match[1]!),
    text: unescapeHtml(match[2]!),
  }));
}

/** One line of the transcript box: a sentence, or a slice of a long one,
 *  with the stretch of the video it covers. */
export interface TranscriptLine {
  start: number;
  end: number;
  text: string;
}

/** A line shorter than this joins the next one… */
const LINE_MIN_WORDS = 4;
/** …and one longer is cut into even slices (automatic captions have no
 *  sentence ends at all). */
const LINE_MAX_WORDS = 24;
/** Speaking rate guessed for the last paragraph, which has no next start to
 *  end it. About 160 words a minute. */
const CHARS_PER_SECOND = 15;

const SENTENCE_BREAK = /(?<=[.!?…]["'”’)\]]*)\s+/;

function linesOfParagraph(text: string): string[] {
  const sentences: string[] = [];
  for (const sentence of text.split(SENTENCE_BREAK)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const slices = Math.ceil(words.length / LINE_MAX_WORDS);
    const size = Math.ceil(words.length / slices);
    for (let i = 0; i < words.length; i += size) sentences.push(words.slice(i, i + size).join(" "));
  }
  const lines: string[] = [];
  let carry = "";
  for (const sentence of sentences) {
    const line = carry ? `${carry} ${sentence}` : sentence;
    if (line.split(" ").length < LINE_MIN_WORDS) carry = line;
    else {
      lines.push(line);
      carry = "";
    }
  }
  if (carry) {
    if (lines.length) lines[lines.length - 1] += ` ${carry}`;
    else lines.push(carry);
  }
  return lines;
}

/**
 * The paragraphs cut into lines a teleprompter can follow. The note keeps
 * only each paragraph's start, so a line's time is where its first letter
 * falls in the paragraph, spread over the time until the next one: speech
 * runs at a near even pace within a minute, so this lands within a few
 * seconds.
 */
export function transcriptLines(paragraphs: readonly TranscriptCue[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  paragraphs.forEach((paragraph, index) => {
    const parts = linesOfParagraph(paragraph.text);
    const chars = parts.reduce((total, part) => total + part.length, 0);
    const next = paragraphs[index + 1]?.start;
    const length =
      next !== undefined && next > paragraph.start
        ? next - paragraph.start
        : chars / CHARS_PER_SECOND;
    let before = 0;
    for (const part of parts) {
      lines.push({ start: paragraph.start + (length * before) / chars, end: 0, text: part });
      before += part.length;
    }
    // The paragraph's end is the next one's start (or the guess above).
    if (lines.length) lines[lines.length - 1]!.end = paragraph.start + length;
  });
  for (let i = 0; i < lines.length - 1; i++) lines[i]!.end = lines[i + 1]!.start;
  return lines;
}

/** The line being spoken at `seconds`: the last one started by then, the
 *  first before the video starts, -1 for no lines. */
export function lineAt(lines: readonly TranscriptLine[], seconds: number): number {
  if (!lines.length) return -1;
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lines[mid]!.start <= seconds) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The transcript as plain text for the clipboard: one paragraph per block,
 *  each after its time. */
export function transcriptText(paragraphs: readonly TranscriptCue[]): string {
  return paragraphs.map(({ start, text }) => `${formatVideoTime(start)} ${text}`).join("\n\n");
}

/** The lines heard in the `before` seconds up to `seconds` and the next
 *  `after`, for telling the agent what "just now" means. */
export function linesAround(
  lines: readonly TranscriptLine[],
  seconds: number,
  before = 90,
  after = 10,
): TranscriptLine[] {
  return lines.filter((line) => line.end > seconds - before && line.start <= seconds + after);
}
