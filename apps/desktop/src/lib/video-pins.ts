import { pageProperty } from "./book-highlights";
import { nextItemPrefix } from "./block-refs";
import { LINK_KEYS, webAddressIn, youtubeVideoId } from "./covers";
import { getFileStem } from "./paths";

// Pins on a YouTube note (SPECs/youtube-notes-spec.md). A pin is a hidden
// block id, `^yt-<seconds>`, at the end of the block it stamps: the moment
// the note was taken. Only meaningful on its own note, whose link is the
// video. A board carries `Page#^yt-<seconds>` instead. Pure text functions;
// the editor wiring lives in `components/editor-area/video-pin.ts`.

/** The pin glyph (Lucide's map-pin, 24-unit box) as one path, for places
 *  that draw it without React: the editor's pin widget and the board. */
export const PIN_ICON_PATH =
  "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0 M15 10a3 3 0 1 1-6 0a3 3 0 1 1 6 0";

const PIN_ID_RE = /^yt-(\d+)(?:-\d+)?$/;

/** The id for a pin at `seconds`, unique among `taken`: `yt-754`, then
 *  `yt-754-2`, `yt-754-3`, … for more pins in the same second. */
export function videoPinId(seconds: number, taken: ReadonlySet<string>): string {
  const base = `yt-${Math.max(0, Math.floor(seconds))}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** The second a pin id stands for; null for any other block id. */
export function parseVideoPinId(id: string): number | null {
  const match = PIN_ID_RE.exec(id);
  return match ? Number(match[1]) : null;
}

/** `m:ss`, or `h:mm:ss` from an hour on. */
export function formatVideoTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The YouTube video a note's properties link to (`url`, `link` or `source`,
 *  as Library covers read them), or null. */
export function videoIdOf(frontmatter: string | null): string | null {
  if (!frontmatter) return null;
  for (const key of LINK_KEYS) {
    const address = webAddressIn(pageProperty(frontmatter, key) ?? undefined);
    const id = address ? youtubeVideoId(address) : null;
    if (id) return id;
  }
  return null;
}

/** A board element's `ln` for a pin on `notePath`'s video. */
export function videoLinkTarget(notePath: string, seconds: number): string {
  return `${getFileStem(notePath)}#^yt-${Math.max(0, Math.floor(seconds))}`;
}

/** The page and second in a board pin link; null for any other link. */
export function parseVideoLink(inner: string): { page: string; seconds: number } | null {
  const at = inner.lastIndexOf("#^");
  if (at <= 0) return null;
  const seconds = parseVideoPinId(inner.slice(at + 2).split("|")[0]!);
  return seconds === null ? null : { page: inner.slice(0, at), seconds };
}

const EMPTY_ITEM_RE = /^(\s*)([-*+]|\d+[.)])[ \t]*$/;

/**
 * A pin on a line with nothing in it yet: a blank line becomes a bullet, an
 * empty item keeps its marker. Returns the line's new text and where the
 * caret goes in it (between the marker and the hidden id, ready to type), or
 * null when the line already has content.
 */
export function pinEmptyLine(line: string, id: string): { text: string; caret: number } | null {
  let head: string;
  const item = EMPTY_ITEM_RE.exec(line);
  if (item) head = `${item[1]}${item[2]} `;
  else if (!line.trim()) head = `${/^\s*/.exec(line)![0]}- `;
  else return null;
  return { text: `${head} ^${id}`, caret: head.length };
}

/** A new pinned item after the block whose first line is `line`: the next
 *  item of its list, or a top-level bullet after any other block. */
export function pinnedItemAfter(line: string, id: string): { text: string; caret: number } {
  const head = nextItemPrefix(line) ?? "- ";
  return { text: `${head} ^${id}`, caret: head.length };
}
