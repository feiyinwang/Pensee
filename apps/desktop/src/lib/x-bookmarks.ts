import { isMap, isScalar, parseDocument, stringify } from "yaml";

import { safePageName } from "./wiki-pages";

// X bookmarks as notes, per SPECs/x-bookmarks-spec.md. Rust talks to X
// (`commands/x_bookmarks.rs`); this module turns what it returns into one
// markdown note per bookmark. Everything here takes its I/O as arguments so
// the sync can be tested without X or a vault.

export const TWEET_TYPE = "Tweet";
export const DEFAULT_BOOKMARKS_FOLDER = "Bookmarks";

export interface XAccount {
  username: string;
  name: string;
}

export interface XMedia {
  kind: "photo" | "video" | "gif";
  url: string;
  poster: string | null;
  durationMs: number | null;
  alt: string | null;
}

export interface XQuote {
  authorName: string | null;
  authorHandle: string | null;
  text: string;
  url: string;
}

export interface XPost {
  id: string;
  text: string;
  media: XMedia[];
  quote: XQuote | null;
}

export interface XBookmark {
  id: string;
  url: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  conversationId: string;
  postedAt: string;
  mayHaveThread: boolean;
  posts: XPost[];
}

/** A media file after the download: its path relative to the note's folder,
 *  or null when it couldn't be saved. */
export interface SavedMedia {
  media: XMedia;
  path: string | null;
  poster: string | null;
}

const NAME_WORDS_LENGTH = 60;

/** `Lena Park – I wrote every first draft this year in 90…`: the author and
 *  the first words of the post, without links. */
export function bookmarkNoteName(bookmark: XBookmark): string {
  const text = (bookmark.posts[0]?.text ?? "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let words = text;
  if (text.length > NAME_WORDS_LENGTH) {
    const cut = text.slice(0, NAME_WORDS_LENGTH);
    const space = cut.lastIndexOf(" ");
    words = `${(space > 20 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?–-]+$/, "")}…`;
  }
  const name = safePageName(words ? `${bookmark.authorName} – ${words}` : bookmark.authorName);
  return name || safePageName(`@${bookmark.authorHandle} ${bookmark.id}`);
}

/** The media file name for the `n`th item (from 1) of the `post`th post. A
 *  GIF is saved as MP4, and `-gif` tells the editor to play it like one. */
export function mediaFileName(post: number, n: number, kind: XMedia["kind"]): string {
  return kind === "gif" ? `${post}-${n}-gif` : `${post}-${n}`;
}

/** Keep a post's text as text: a line that would start a heading, quote,
 *  list or rule in markdown is escaped. Single line breaks stay as written. */
export function escapePostText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)([-*=_]{3,})\s*$/, "$1\\$2")
        .replace(/^(\s*)([#>+])/, "$1\\$2")
        .replace(/^(\s*)([-*])(\s|$)/, "$1\\$2$3")
        .replace(/^(\s*)(\d+)([.)])(\s|$)/, "$1$2\\$3$4"),
    )
    .join("\n");
}

function yamlLine(key: string, value: string | number): string {
  return `${key}: ${stringify(value, { lineWidth: 0 }).trimEnd()}`;
}

/** `2026-10-08` from X's `2026-10-08T14:03:00.000Z`. */
function dateOf(iso: string): string | null {
  return /^\d{4}-\d{2}-\d{2}/.exec(iso)?.[0] ?? null;
}

function quoteBlock(quote: XQuote): string {
  const who = quote.authorName
    ? `**${quote.authorName}**${quote.authorHandle ? ` (@${quote.authorHandle})` : ""}`
    : quote.authorHandle
      ? `**@${quote.authorHandle}**`
      : "Quoted post";
  const lines = [`${who} · [post](${quote.url})`];
  if (quote.text) lines.push("", ...escapePostText(quote.text).split("\n"));
  return lines.map((line) => (line ? `> ${line}` : ">")).join("\n");
}

function mediaBlock(saved: SavedMedia, postUrl: string): string {
  if (saved.path) return `![[${saved.path}]]`;
  const what =
    saved.media.kind === "photo" ? "Photo" : saved.media.kind === "gif" ? "GIF" : "Video";
  return `[${what} didn't download · see it on X](${postUrl})`;
}

/** The note for a bookmark: properties, then each post of the thread with
 *  its media, posts separated by `---`. `media[i]` is post i's saved media. */
export function bookmarkNote(bookmark: XBookmark, media: SavedMedia[][], savedOn: string): string {
  const all = media.flat();
  const first = all.find((m) => m.path);
  const cover = first ? (first.media.kind === "photo" ? first.path : first.poster) : null;
  const firstPostMedia = media.find((m) => m.length)?.filter((m) => m.path) ?? [];
  const kind = first?.media.kind;

  const properties = [
    yamlLine("Type", TWEET_TYPE),
    yamlLine("Author", bookmark.authorName),
    yamlLine("Handle", bookmark.authorHandle),
    yamlLine("URL", bookmark.url),
    // Quoted so YAML never reads a long id as a number and rounds it.
    `ID: "${bookmark.id}"`,
  ];
  const posted = dateOf(bookmark.postedAt);
  if (posted) properties.push(yamlLine("Posted", posted));
  properties.push(yamlLine("Saved", savedOn), yamlLine("Posts", bookmark.posts.length));
  if (cover) properties.push(yamlLine("Cover", cover));
  if (kind) {
    const photos = firstPostMedia.filter((m) => m.media.kind === "photo").length;
    properties.push(yamlLine("Media", kind === "photo" ? "photos" : kind));
    if (kind === "photo" && photos > 1) properties.push(yamlLine("Photos", photos));
    const duration = first?.media.durationMs;
    if (kind === "video" && duration)
      properties.push(yamlLine("Duration", Math.round(duration / 1000)));
  }

  const posts = bookmark.posts.map((post, i) => {
    const blocks: string[] = [];
    if (post.text) blocks.push(escapePostText(post.text));
    for (const saved of media[i] ?? []) blocks.push(mediaBlock(saved, bookmark.url));
    if (post.quote) blocks.push(quoteBlock(post.quote));
    return blocks.join("\n\n");
  });

  return `---\n${properties.join("\n")}\n---\n\n${posts.join("\n\n---\n\n")}\n`;
}

/** What the opened note's thread view shows above the posts, from its
 *  properties. */
export interface TweetNoteProps {
  author: string | null;
  handle: string | null;
  url: string | null;
  posted: string | null;
  saved: string | null;
  /** The thread's length as written; null when missing or not a count. */
  posts: number | null;
}

/** The properties of a `Type: Tweet` note (keys matched ignoring case), or
 *  null for any other note. Values are read as text, so a YAML date or
 *  number reads the same as a quoted one. */
export function tweetNoteProps(frontmatter: string | null): TweetNoteProps | null {
  // Most notes are not bookmarks: skip the YAML parse unless the type is there.
  if (!frontmatter || !/^type\s*:\s*["']?tweet\b/im.test(frontmatter)) return null;
  const doc = parseDocument(frontmatter);
  if (doc.errors.length || !isMap(doc.contents)) return null;
  const values = new Map<string, string>();
  for (const pair of doc.contents.items) {
    if (!isScalar(pair.key) || !isScalar(pair.value)) continue;
    const value = pair.value.value;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue;
    }
    const text = String(value).trim();
    if (text) values.set(String(pair.key.value).toLowerCase(), text);
  }
  if (values.get("type")?.toLowerCase() !== TWEET_TYPE.toLowerCase()) return null;
  const posts = Number(values.get("posts"));
  return {
    author: values.get("author") ?? null,
    handle: values.get("handle")?.replace(/^@/, "") ?? null,
    url: values.get("url") ?? null,
    posted: values.get("posted") ?? null,
    saved: values.get("saved") ?? null,
    posts: Number.isInteger(posts) && posts > 0 ? posts : null,
  };
}

export interface XSyncDeps {
  /** Folder new notes go in, absolute. */
  folder: string;
  /** IDs of bookmarks that already have a note in the vault. */
  knownIds: () => Promise<string[]>;
  listNew: (knownIds: string[]) => Promise<XBookmark[]>;
  expand: (bookmark: XBookmark) => Promise<XBookmark>;
  saveMedia: (url: string, notePath: string, name: string) => Promise<string>;
  fileExists: (path: string) => Promise<boolean>;
  createNote: (path: string, content: string) => Promise<void>;
  markSaved: (ids: string[]) => Promise<void>;
  today: () => string;
  onProgress: (done: number, total: number) => void;
  /** False once the workspace changed; the sync stops between bookmarks. */
  isCurrent: () => boolean;
}

export interface XSyncResult {
  saved: number;
  /** Media files that didn't download; their notes link to the post instead. */
  missingMedia: number;
}

/** A free `<folder>/<name>.md`, adding ` 2`, ` 3`… when it's taken. */
async function freeNotePath(folder: string, name: string, exists: XSyncDeps["fileExists"]) {
  for (let n = 1; ; n++) {
    const path = `${folder}/${n === 1 ? name : `${name} ${n}`}.md`;
    if (!(await exists(path))) return path;
  }
}

/** Save every new bookmark as a note, oldest first so the newest ends up the
 *  most recently written. A bookmark is recorded as saved only once its note
 *  exists, so a failed or stopped sync picks up where it left off. Errors
 *  from X stop the sync and are thrown; a media file that won't download
 *  doesn't. */
export async function syncXBookmarks(deps: XSyncDeps): Promise<XSyncResult> {
  const known = await deps.knownIds();
  const fresh = (await deps.listNew(known)).reverse();
  const result: XSyncResult = { saved: 0, missingMedia: 0 };
  deps.onProgress(0, fresh.length);
  for (const listed of fresh) {
    if (!deps.isCurrent()) break;
    const bookmark = await deps.expand(listed);
    const path = await freeNotePath(deps.folder, bookmarkNoteName(bookmark), deps.fileExists);
    const media: SavedMedia[][] = [];
    for (const [p, post] of bookmark.posts.entries()) {
      const saved: SavedMedia[] = [];
      for (const [m, item] of post.media.entries()) {
        const name = mediaFileName(p + 1, m + 1, item.kind);
        const download = (url: string, file: string) =>
          deps.saveMedia(url, path, file).catch((error: unknown) => {
            console.error(`[x-bookmarks] Couldn't save ${url}:`, error);
            result.missingMedia++;
            return null;
          });
        const filePath = await download(item.url, name);
        const poster =
          item.kind !== "photo" && item.poster && filePath
            ? await download(item.poster, `${name}-poster`)
            : null;
        saved.push({ media: item, path: filePath, poster });
      }
      media.push(saved);
    }
    await deps.createNote(path, bookmarkNote(bookmark, media, deps.today()));
    await deps.markSaved([bookmark.id]);
    result.saved++;
    deps.onProgress(result.saved, fresh.length);
  }
  return result;
}
