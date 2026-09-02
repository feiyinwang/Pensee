import { getFileStem, getParentDir, normalizePath } from "./paths";
import type { SearchResult } from "@/types/fs";

export type WikiLinkTarget = { kind: "internal"; path: string } | { kind: "unresolved" };
export interface ParsedWikiLink {
  raw: string;
  target: string;
  path: string;
  fragment: string | null;
  alias: string | null;
  displayText: string;
}

function unescapeWikiText(text: string): string {
  return text.replace(/\\\|/g, "|").trim();
}

function splitAlias(raw: string): { target: string; alias: string | null } {
  const separator = raw.indexOf("|");
  if (separator === -1) {
    return { target: raw, alias: null };
  }

  const escapedSeparator = separator > 0 && raw[separator - 1] === "\\";
  const targetEnd = escapedSeparator ? separator - 1 : separator;

  return {
    target: raw.slice(0, targetEnd),
    alias: unescapeWikiText(raw.slice(separator + 1)),
  };
}

function splitFragment(target: string): { path: string; fragment: string | null } {
  const hashIndex = target.indexOf("#");
  if (hashIndex === -1) {
    return { path: target, fragment: null };
  }

  return {
    path: target.slice(0, hashIndex),
    fragment: target.slice(hashIndex + 1),
  };
}

export function parseWikiLink(raw: string): ParsedWikiLink {
  const { target, alias } = splitAlias(raw.trim());
  const normalizedTarget = unescapeWikiText(target);
  const { path, fragment } = splitFragment(normalizedTarget);
  const normalizedPath = normalizeWikiTarget(path);
  const fallbackDisplay = normalizedPath || (fragment ? `#${fragment}` : normalizedTarget);

  return {
    raw,
    target: normalizedTarget,
    path: normalizedPath,
    fragment,
    alias: alias || null,
    displayText: alias || fallbackDisplay,
  };
}

/**
 * Normalize a raw wiki-link target string for resolution:
 * trim whitespace, normalize backslashes, strip .md/.markdown extension.
 */
export function normalizeWikiTarget(raw: string): string {
  let target = raw.trim().replace(/\\/g, "/");
  target = target.replace(/^\/+/, "");
  const lower = target.toLowerCase();
  if (lower.endsWith(".md")) {
    target = target.slice(0, -3);
  } else if (lower.endsWith(".markdown")) {
    target = target.slice(0, -9);
  }
  return target;
}

/**
 * Resolve a wiki-link target to an internal file path or unresolved.
 *
 * - If the target contains `/`, treat it as a workspace-relative path (without extension).
 * - Otherwise, treat it as a stem lookup across the workspace.
 *   Resolves only when exactly one markdown file matches the stem.
 */
export async function resolveWikiLink(
  raw: string,
  workspaceRoot: string,
  fuzzySearch: (query: string, limit?: number) => Promise<SearchResult[]>,
  fileExists: (path: string) => Promise<boolean>,
  currentFilePath?: string | null,
): Promise<WikiLinkTarget> {
  const link = parseWikiLink(raw);
  const target = link.path;
  if (!target && link.fragment && currentFilePath) {
    return { kind: "internal", path: currentFilePath };
  }
  if (!target) return { kind: "unresolved" };

  if (target.includes("/")) {
    const basePath = normalizePath(`${workspaceRoot.replace(/\/$/, "")}/${target}`);
    const candidatePaths = [`${basePath}.md`, `${basePath}.markdown`];
    const existence = await Promise.all(candidatePaths.map((path) => fileExists(path)));
    const matchIndex = existence.findIndex(Boolean);
    if (matchIndex !== -1) {
      return { kind: "internal", path: candidatePaths[matchIndex] };
    }
    return { kind: "unresolved" };
  }

  // Stem lookup: find all files whose stem matches (case-insensitive)
  const results = await fuzzySearch(target, 50);
  const targetLower = target.toLowerCase();
  const exactMatches = results.filter((r) => getFileStem(r.filename).toLowerCase() === targetLower);

  if (exactMatches.length === 1) {
    return { kind: "internal", path: exactMatches[0].path };
  }

  return { kind: "unresolved" };
}

// Image formats supported by Obsidian-style embeds (`![[image.png]]`),
// per SPECs/obsidian-image-embed-spec.md.
const WIKI_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

// HTML files embed as a sandboxed frame (`![[page.html]]`), per
// SPECs/html-file-embed-spec.md.
const WIKI_HTML_EXTENSIONS = new Set(["html", "htm"]);

export const HTML_EMBED_DEFAULT_HEIGHT = 400;
export const HTML_EMBED_MIN_HEIGHT = 120;
export const HTML_EMBED_MAX_HEIGHT = 2000;

/** Matches `[[target]]` and `![[target]]`. Group 1: the optional `!` embed
 *  prefix (must be captured — treating `![[img.png]]` as a plain link used to
 *  render a link widget with a stray literal `!`). Group 2: the inner text. */
export const WIKI_LINK_RE = /(!?)\[\[([^\]]+)\]\]/g;

export interface WikiLinkMatch {
  from: number;
  to: number;
  /** `true` when the token carries the `!` embed prefix. */
  embed: boolean;
  inner: string;
}

/**
 * Find the `[[...]]` / `![[...]]` token on the line containing `pos`. A
 * token starting exactly at `pos` wins over one that merely spans it, so a
 * widget's own start position resolves to that widget when two embeds sit
 * side by side. Returns null when no token covers `pos`.
 */
export function findWikiLinkAt(
  doc: { lineAt(pos: number): { from: number; text: string } },
  pos: number,
): WikiLinkMatch | null {
  const line = doc.lineAt(pos);
  let spanning: WikiLinkMatch | null = null;
  WIKI_LINK_RE.lastIndex = 0;
  let match;
  while ((match = WIKI_LINK_RE.exec(line.text)) !== null) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos < from || pos > to) continue;
    const found = { from, to, embed: match[1] === "!", inner: match[2]! };
    if (from === pos) return found;
    spanning ??= found;
  }
  return spanning;
}

/** Slash-normalized embed path with any leading `/` stripped, or null when
 *  the target has no usable extension. */
function embedPathWithExtension(target: string): { path: string; ext: string } | null {
  const path = unescapeWikiText(target).replace(/\\/g, "/").replace(/^\/+/, "");
  const dot = path.lastIndexOf(".");
  if (dot <= 0 || dot === path.length - 1) return null;
  return { path, ext: path.slice(dot + 1).toLowerCase() };
}

/**
 * Parse the inner text of a `![[...]]` embed. Returns the normalized image
 * path (slashes normalized, leading `/` stripped) when the target is an
 * image, or null for non-image embeds (note transclusions, PDFs, …).
 * Anything after an unescaped `|` (alias / size modifiers) is ignored —
 * v1 non-goals per the spec.
 */
export function parseWikiImageEmbedTarget(raw: string): string | null {
  const { target } = splitAlias(raw.trim());
  const parsed = embedPathWithExtension(target);
  return parsed && WIKI_IMAGE_EXTENSIONS.has(parsed.ext) ? parsed.path : null;
}

export interface WikiHtmlEmbed {
  path: string;
  /** Frame height in px, clamped to the allowed range. */
  height: number;
  /** Whether the source carried an explicit `|N` modifier. */
  explicitHeight: boolean;
}

/**
 * Parse the inner text of a `![[...]]` embed as an HTML file embed:
 * `page.html` or `page.html|480`. Only the first `|` segment is read, and
 * only when it is a bare integer; anything else (an alias, a second
 * segment) is ignored rather than rejected so future modifiers do not
 * break old notes. Returns null for non-HTML targets.
 */
export function parseWikiHtmlEmbedTarget(raw: string): WikiHtmlEmbed | null {
  const { target, alias } = splitAlias(raw.trim());
  const parsed = embedPathWithExtension(target);
  if (!parsed || !WIKI_HTML_EXTENSIONS.has(parsed.ext)) return null;
  const firstSegment = alias?.split("|")[0]?.trim() ?? "";
  const explicit = /^\d{1,5}$/.test(firstSegment);
  const height = explicit
    ? Math.min(HTML_EMBED_MAX_HEIGHT, Math.max(HTML_EMBED_MIN_HEIGHT, Number(firstSegment)))
    : HTML_EMBED_DEFAULT_HEIGHT;
  return { path: parsed.path, height, explicitHeight: explicit };
}

/**
 * Rewrite an embed's inner text with a new `|height` modifier, keeping the
 * target text exactly as written (no normalization) so the only characters
 * that change in the note are the modifier's.
 */
export function withWikiEmbedHeight(inner: string, height: number): string {
  const { target } = splitAlias(inner.trim());
  return `${target}|${Math.round(height)}`;
}

/**
 * Resolve a wiki embed target (image or HTML file) to an absolute file path, or null.
 *
 * - Targets with `/` resolve workspace-relative first (Obsidian vault-path
 *   semantics), then relative to the current note's directory.
 * - Bare basenames probe next to the note and at the workspace root, then
 *   fall back to a case-insensitive basename search across the workspace
 *   (`findFileByName`) — Obsidian's default "shortest path" links reference
 *   attachments by bare filename wherever they live.
 * - Without a workspace (compact windows), only note-relative probing
 *   applies.
 */
export async function resolveWikiEmbed(
  target: string,
  workspaceRoot: string | null,
  currentFilePath: string | null,
  fileExists: (path: string) => Promise<boolean>,
  findFileByName: (root: string, fileName: string) => Promise<string | null>,
): Promise<string | null> {
  const noteDir = currentFilePath ? getParentDir(currentFilePath) : null;
  const root = workspaceRoot ? workspaceRoot.replace(/\/$/, "") : null;

  const candidates: string[] = [];
  const pushCandidate = (base: string | null) => {
    if (!base) return;
    const path = normalizePath(`${base}/${target}`);
    if (!candidates.includes(path)) candidates.push(path);
  };
  if (target.includes("/")) {
    pushCandidate(root);
    pushCandidate(noteDir);
  } else {
    pushCandidate(noteDir);
    pushCandidate(root);
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  if (root && !target.includes("/")) {
    return findFileByName(root, target);
  }
  return null;
}

/**
 * Compute the canonical insertion text for a selected file.
 * Uses the shortest unambiguous form: bare stem when unique,
 * workspace-relative path (without extension) when duplicate stems exist.
 */
export function canonicalWikiTarget(file: SearchResult, allFiles: SearchResult[]): string {
  const stem = getFileStem(file.filename);
  const stemLower = stem.toLowerCase();

  const hasDuplicate = allFiles.some(
    (f) => f.path !== file.path && getFileStem(f.filename).toLowerCase() === stemLower,
  );

  if (!hasDuplicate) return stem;

  return stripMdExtension(file.relative_path);
}

function stripMdExtension(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md")) return path.slice(0, -3);
  if (lower.endsWith(".markdown")) return path.slice(0, -9);
  return path;
}
