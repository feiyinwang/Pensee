import { getFileStem, getParentDir, normalizePath } from "./paths";
import { parseWikiLink, resolveWikiLink } from "./wiki-links";
import type { SearchResult } from "@/types/fs";

// Pages behind `[[wiki links]]`: naming, where a new one lives, and creating
// it. Pure except for the injected file-system calls, so every rule here is
// unit tested without Tauri.

export interface WikiPageDeps {
  fuzzySearch: (query: string, limit?: number) => Promise<SearchResult[]>;
  fileExists: (path: string) => Promise<boolean>;
  /** Create the file, failing if it already exists. */
  createFile: (path: string) => Promise<unknown>;
  writeFile: (path: string, content: string) => Promise<unknown>;
}

/** Characters that cannot or should not be in a page's file name: path
 *  separators, the ones Windows and Obsidian reject, and the wiki-link syntax
 *  itself (`#` fragment, `|` alias, `^` block ref, brackets). */
const UNSAFE_NAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

const MAX_TITLE_LENGTH = 100;

/** The page a `[[...]]` token's inner text names, or null when it names none:
 *  empty, fragment-only (`[[#Heading]]`), or a non-markdown file
 *  (`[[photo.png]]`, which is an attachment, not a page). */
export function pageNameFromWikiTarget(inner: string): string | null {
  const { path } = parseWikiLink(inner);
  if (!path) return null;
  const last = path.slice(path.lastIndexOf("/") + 1);
  if (!last || last.startsWith(".")) return null;
  // `normalizeWikiTarget` already stripped `.md`, so any extension left means
  // some other kind of file.
  if (/\.[a-z0-9]{1,8}$/i.test(last)) return null;
  return path;
}

/** Where a new page for `name` goes. A name with a `/` is workspace-relative,
 *  matching how `resolveWikiLink` reads it; a bare name lands next to the note
 *  that links to it (or at the workspace root when that note is outside the
 *  workspace), so a folder of notes stays together. */
export function newPagePath(
  name: string,
  workspaceRoot: string,
  currentFilePath: string | null,
): string {
  const root = workspaceRoot.replace(/\/$/, "");
  if (name.includes("/")) return normalizePath(`${root}/${name}.md`);
  const inWorkspace = currentFilePath?.startsWith(`${root}/`) ?? false;
  const dir = inWorkspace ? getParentDir(currentFilePath!) : root;
  return normalizePath(`${dir}/${name}.md`);
}

/** Starter content for a page created from a link: its name as the title. */
export function newPageContent(title: string, body = ""): string {
  const trimmed = body.replace(/^\s*\n/, "").trimEnd();
  return trimmed ? `# ${title}\n\n${trimmed}\n` : `# ${title}\n`;
}

const inFlight = new Map<string, Promise<string>>();

/** Path of the existing page `name` refers to, or null when there is none.
 *  Found the way a click finds it (`resolveWikiLink`), then by its would-be
 *  path directly: the search index catches up with a new file a moment after
 *  it is written, and a stem shared by pages in two folders resolves to
 *  neither, while the one beside the current note is still the right one. */
export async function findWikiPage(
  name: string,
  workspaceRoot: string,
  currentFilePath: string | null,
  deps: Pick<WikiPageDeps, "fuzzySearch" | "fileExists">,
): Promise<string | null> {
  const resolved = await resolveWikiLink(
    name,
    workspaceRoot,
    deps.fuzzySearch,
    deps.fileExists,
    currentFilePath,
  );
  if (resolved.kind === "internal") return resolved.path;
  const path = newPagePath(name, workspaceRoot, currentFilePath);
  return (await deps.fileExists(path)) ? path : null;
}

/**
 * Path of the page `inner` links to, creating it first when nothing matches.
 * Returns null when the link names no page (see `pageNameFromWikiTarget`).
 * Concurrent calls for one path share a single creation.
 */
export async function ensureWikiPage(
  inner: string,
  workspaceRoot: string,
  currentFilePath: string | null,
  deps: WikiPageDeps,
): Promise<string | null> {
  const name = pageNameFromWikiTarget(inner);
  if (!name) return null;

  const existing = await findWikiPage(name, workspaceRoot, currentFilePath, deps);
  if (existing) return existing;

  const path = newPagePath(name, workspaceRoot, currentFilePath);
  const pending = inFlight.get(path);
  if (pending) return pending;

  const creation = (async () => {
    if (await deps.fileExists(path)) return path;
    await deps.createFile(path);
    await deps.writeFile(path, newPageContent(getFileStem(path)));
    return path;
  })();
  inFlight.set(path, creation);
  try {
    return await creation;
  } finally {
    inFlight.delete(path);
  }
}

/** `raw` with `body` added at the end as its own block, separated by one blank
 *  line. An empty page just becomes the body. */
export function appendPageBody(raw: string, body: string): string {
  const addition = body.replace(/^\s*\n/, "").trimEnd();
  if (!addition) return raw;
  const base = raw.trimEnd();
  return base ? `${base}\n\n${addition}\n` : `${addition}\n`;
}

export interface SelectionPage {
  title: string;
  body: string;
}

/** Split selected text into a page: the first non-blank line is the title
 *  (markdown markers stripped, made safe as a file name), everything after it
 *  is the body. Null when there is no usable title. */
export function pageFromSelection(text: string): SelectionPage | null {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first === -1) return null;
  const title = lines[first]!.trim()
    // Block markers: heading, quote, list bullet or number, task box.
    .replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)+/, "")
    // Wiki links and markdown links keep their visible text.
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Inline emphasis and code marks.
    .replace(/[*_`~=]+/g, "")
    .replace(UNSAFE_NAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, MAX_TITLE_LENGTH)
    .trim();
  if (!title) return null;
  return { title, body: lines.slice(first + 1).join("\n") };
}
