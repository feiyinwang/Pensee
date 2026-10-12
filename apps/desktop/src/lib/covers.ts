import { stringify } from "yaml";
import type { CoverKind } from "./spaces";
import type { TypedNote } from "./tauri";

// Covers from the web for Library notes (SPECs/spaces-spec.md, "Covers from
// the web"). A YouTube note with no `Cover:` shows its thumbnail straight from
// its link; "Get cover" downloads it (or a podcast page's Open Graph image)
// into the note's assets folder and writes `Cover:`, so it stays markdown.

/** Frontmatter keys a note keeps its web address under, in order of trust. */
const LINK_KEYS = ["url", "link", "source"] as const;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

/** A frontmatter value that says nothing: blank, `null` or `~`. */
function isBlank(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return !v || v === "null" || v === "~";
}

/** The first web address in a property value: bare, in `<>`, or in a
 *  markdown link. A value with no scheme (`youtube.com/watch?v=…`) gets https. */
export function webAddressIn(value: string | undefined): string | null {
  if (isBlank(value)) return null;
  const text = value!.trim();
  const found = text.match(/https?:\/\/[^\s<>()[\]"']+/i)?.[0];
  if (found) return found;
  const bare = text.replace(/^<|>$/g, "");
  return /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(bare) ? `https://${bare}` : null;
}

/** The note's web address, from its first non-blank link-like property. */
export function noteLink(note: TypedNote): string | null {
  for (const key of LINK_KEYS) {
    const address = webAddressIn(note.properties[key]);
    if (address) return address;
  }
  return null;
}

/** The video id of a YouTube watch, short, embed, shorts or live link. */
export function youtubeVideoId(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  let id: string | null | undefined = null;
  if (host === "youtu.be") {
    id = segments[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === "watch") id = url.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(segments[0] ?? "")) id = segments[1];
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

export function youtubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function hasCoverProperty(note: TypedNote): boolean {
  return !isBlank(note.properties.cover);
}

/** The thumbnail a video note shows before it has a `Cover:` of its own. */
export function liveCoverSrc(note: TypedNote, kind: CoverKind): string | null {
  if (kind !== "video") return null;
  const link = noteLink(note);
  const id = link ? youtubeVideoId(link) : null;
  return id ? youtubeThumbnail(id) : null;
}

/** What "Get cover" downloads for a note without a `Cover:`: a video's
 *  YouTube thumbnail, or the page of a podcast (whose Open Graph image is its
 *  artwork). Null when there is nothing to get. */
export function coverToGet(note: TypedNote, kind: CoverKind): string | null {
  if (hasCoverProperty(note)) return null;
  if (kind === "video") return liveCoverSrc(note, kind);
  if (kind === "podcast") return noteLink(note);
  return null;
}

const COVER_LINE = /^cover[ \t]*:(.*)$/i;

/**
 * `frontmatter` with `Cover: <value>`: a blank `Cover:` line (the vault's
 * templates leave one) is filled in place, else the line is added after
 * `Type:`. Every other line stays byte for byte. Returns the input unchanged
 * when the note already has a cover, which is never replaced.
 */
export function withCover(frontmatter: string | null, value: string): string {
  const line = `Cover: ${stringify(value, { lineWidth: 0 }).trimEnd()}`;
  if (frontmatter === null || frontmatter.trim() === "") return line;
  const lines = frontmatter.split("\n");
  const existing = lines.findIndex((l) => COVER_LINE.test(l));
  if (existing !== -1) {
    const rest = lines[existing]!.match(COVER_LINE)![1]!.replace(/[ \t]+#.*$/, "");
    if (!isBlank(rest)) return frontmatter;
    lines[existing] = line;
    return lines.join("\n");
  }
  const type = lines.findIndex((l) => /^type[ \t]*:/i.test(l));
  lines.splice(type + 1, 0, line);
  return lines.join("\n");
}
