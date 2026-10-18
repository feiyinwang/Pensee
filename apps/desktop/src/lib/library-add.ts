import { isMap, isScalar, isSeq, parseDocument, type Pair } from "yaml";
import { noteLink, webAddressIn, youtubeVideoId } from "./covers";
import { yamlLine } from "./yaml-entries";
import type { TypedNote } from "./tauri";

// Adding to Library from a link, a title or a dropped PDF
// (SPECs/add-to-library-spec.md). Pure: what a pasted link is, which note
// already holds it, and the frontmatter a new Library note starts with.

/** The Library tabs one can add to by hand. */
export type LibraryKind = "book" | "video" | "podcast" | "paper";

export const LIBRARY_KINDS: readonly LibraryKind[] = ["book", "video", "podcast", "paper"];

/** What a row calls the kind: the singular of its Library tab. */
export const LIBRARY_KIND_LABELS: Record<LibraryKind, string> = {
  book: "Book",
  video: "Video",
  podcast: "Podcast",
  paper: "Paper",
};

/** Every `Type` a Library note may have, for finding one already added.
 *  `Course` notes from before courses joined Videos still count. */
export const LIBRARY_NOTE_TYPES = ["Book", "YouTube", "Video", "Podcast", "Course", "Paper"];

/** A Library tab's kind from its id, so the tab's Add button puts it first. */
export function libraryKindOfTab(tabId: string): LibraryKind | null {
  const kind = tabId.replace(/s$/, "");
  return (LIBRARY_KINDS as readonly string[]).includes(kind) ? (kind as LibraryKind) : null;
}

const HOST_KINDS: [RegExp, LibraryKind][] = [
  [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com)$/, "video"],
  [
    /(^|\.)(open\.spotify\.com|podcasts\.apple\.com|overcast\.fm|pca\.st|pocketcasts\.com)$/,
    "podcast",
  ],
  [
    /(^|\.)(arxiv\.org|doi\.org|openreview\.net|acm\.org|ieee\.org|semanticscholar\.org|biorxiv\.org|medrxiv\.org|ssrn\.com|aclanthology\.org|pubmed\.ncbi\.nlm\.nih\.gov)$/,
    "paper",
  ],
  [
    /(^|\.)(coursera\.org|udemy\.com|edx\.org|maven\.com|skillshare\.com|khanacademy\.org|teachable\.com|domestika\.org)$/,
    "video",
  ],
  [/(^|\.)(goodreads\.com|openlibrary\.org|books\.google\.com|bookshop\.org)$/, "book"],
];

export interface LibraryLink {
  url: string;
  /** Host without `www.`, as rows show it. */
  host: string;
  /** The kind the host says, or null for a site Pensée doesn't know. */
  guess: LibraryKind | null;
}

/** The query as a Library link when it is one web address and nothing else. */
export function parseLibraryLink(query: string): LibraryLink | null {
  const text = query.trim();
  if (!text || /\s/.test(text)) return null;
  const address = webAddressIn(text);
  if (!address || (address !== text && address !== `https://${text}`)) return null;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let guess = HOST_KINDS.find(([pattern]) => pattern.test(host))?.[1] ?? null;
  // A spotify link is a podcast only when it is an episode or a show.
  if (
    guess === "podcast" &&
    host === "open.spotify.com" &&
    !/^\/(episode|show)\//.test(url.pathname)
  ) {
    guess = null;
  }
  if (!guess && /(^|\.)amazon\.[a-z.]+$/.test(host) && /\/(dp|gp\/product)\//.test(url.pathname)) {
    guess = "book";
  }
  return { url: address, host, guess };
}

/** Kinds whose note opens as soon as it is added, wherever it was added
 *  from: the note is where a podcast plays (SPECs/podcast-notes-spec.md). */
export function opensWhenAdded(kind: LibraryKind | null): boolean {
  return kind === "podcast";
}

/** The `Type` a new note of `kind` gets: YouTube links keep the vault's
 *  `YouTube` type, other videos `Video`. */
export function libraryNoteType(kind: LibraryKind, host: string | null): string {
  if (kind === "video") return host && /youtu/.test(host) ? "YouTube" : "Video";
  return LIBRARY_KIND_LABELS[kind];
}

/** One identity per source, so the same video, paper or book is found under
 *  any of its addresses: a YouTube id, an arXiv id without its version, a DOI,
 *  else the address without scheme, `www.`, query noise or a trailing slash. */
export function sourceKey(address: string): string | null {
  const youtube = youtubeVideoId(address);
  if (youtube) return `youtube:${youtube}`;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const arxiv = host.endsWith("arxiv.org")
    ? url.pathname.match(/^\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})/)?.[1]
    : undefined;
  if (arxiv) return `arxiv:${arxiv}`;
  const doi = decodeURIComponent(url.pathname).match(
    /\b(10\.\d{4,9}\/[^\s?#]+?)(?:\.pdf)?\/?$/i,
  )?.[1];
  if (doi) return `doi:${doi.toLowerCase()}`;
  const keep = new URLSearchParams();
  // Only the parameters that name the thing; tracking and timestamps go.
  for (const name of ["v", "id", "p", "list"]) {
    const value = url.searchParams.get(name);
    if (value) keep.set(name, value);
  }
  const query = keep.toString();
  return `url:${host}${url.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}`;
}

/** The Library note that already holds `address`, if any. */
export function findLibraryNote(notes: readonly TypedNote[], address: string): TypedNote | null {
  const key = sourceKey(address);
  if (!key) return null;
  return (
    notes.find((note) => {
      const link = noteLink(note);
      if (link !== null && sourceKey(link) === key) return true;
      // Papers often keep only a `DOI:` property, bare or as a link.
      const doi = note.properties.doi?.trim().match(/10\.\d{4,9}\/\S+/)?.[0];
      return doi !== undefined && key === `doi:${doi.toLowerCase()}`;
    }) ?? null
  );
}

/** Frontmatter of a new Library note: its type, and the link it came from.
 *  Properties only, no heading (the writer adds those). */
export function libraryNoteContent(type: string, url: string | null): string {
  // `Link`, as the vault's video and course notes already name it.
  const lines = [yamlLine("Type", type), url ? yamlLine("Link", url) : null].filter(Boolean);
  return `---\n${lines.join("\n")}\n---\n`;
}

/** A file name for a link whose page gave no title: the host and the last
 *  meaningful path segment ("youtube.com dQw4w9WgXcQ"). */
export function fallbackLinkTitle(link: LibraryLink): string {
  const youtube = youtubeVideoId(link.url);
  if (youtube) return `${link.host} ${youtube}`;
  const segment = new URL(link.url).pathname.split("/").filter(Boolean).pop();
  return segment ? `${link.host} ${decodeURIComponent(segment)}` : link.host;
}

/** A page title with the site's name trimmed off ("Title - YouTube"). */
export function cleanPageTitle(title: string, siteName: string | null): string {
  let text = title.trim().replace(/^\[\d{4}\.\d{4,5}(v\d+)?\]\s*/, "");
  const suffixes = [siteName, "YouTube", "Coursera", "Udemy", "arXiv"].filter(Boolean) as string[];
  for (const suffix of suffixes) {
    const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`\\s*[-|–—·:]\\s*${escaped}\\s*$`, "i"), "");
  }
  return text.trim();
}

/** What a PDF's first pages say it is. */
export interface PdfClues {
  pages: number;
  /** The text of the first pages, enough to find an abstract or an ISBN. */
  text: string;
}

/** Paper or book for a dropped PDF, or null when nothing in it decides. An
 *  ISBN or a long file is a book; an arXiv id, or an abstract on a short
 *  file, is a paper. A DOI alone decides nothing: books carry them too. */
export function pdfKind({ pages, text }: PdfClues): "book" | "paper" | null {
  if (/\bISBN(?:-1[03])?:?\s*[\d-]{10,17}/i.test(text)) return "book";
  if (/\barXiv:\s*\d{4}\.\d{4,5}/i.test(text)) return "paper";
  if (pages > 0 && pages <= 50 && /\babstract\b/i.test(text)) return "paper";
  if (pages > 150) return "book";
  return null;
}

/** `frontmatter` with its `Type` set to `type`. A `Book` tag goes with the
 *  old type (an empty tag list goes too), since a dropped PDF's page is
 *  written as a book first. Unreadable YAML comes back unchanged. */
export function withLibraryType(frontmatter: string | null, type: string): string | null {
  if (frontmatter === null || !frontmatter.trim()) return yamlLine("Type", type);
  const doc = parseDocument(frontmatter);
  if (doc.errors.length || !isMap(doc.contents)) {
    console.error("[library] Left unreadable frontmatter unchanged");
    return frontmatter;
  }
  const map = doc.contents;
  const keyOf = (name: string): Pair<unknown, unknown> | undefined =>
    map.items.find((pair) => isScalar(pair.key) && String(pair.key.value).toLowerCase() === name);
  const typePair = keyOf("type");
  if (typePair) typePair.value = doc.createNode(type);
  else map.items.unshift(doc.createPair("Type", type));
  const tags = keyOf("tags");
  if (tags && type !== "Book") {
    const isBookTag = (value: unknown) => String(value).trim().toLowerCase() === "book";
    if (isSeq(tags.value)) {
      tags.value.items = tags.value.items.filter(
        (item) => !isBookTag(isScalar(item) ? item.value : item),
      );
      if (tags.value.items.length === 0) map.delete(tags.key);
    } else if (isScalar(tags.value) && isBookTag(tags.value.value)) {
      map.delete(tags.key);
    }
  }
  return doc.toString({ lineWidth: 0 }).trimEnd();
}
