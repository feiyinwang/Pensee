import {
  formatMarkdownDestination,
  normalizeLocalMarkdownDestination,
  normalizeMarkdownDestination,
  normalizePath,
} from "@/lib/paths";

const EXPLICIT_URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
// `[text](dest "title")` and `![alt](dest)`; `dest` is either `<...>` or a
// run without whitespace or parentheses.
const INLINE_LINK =
  /(!?\[[^\]\n]*\]\()(<[^>\n]*>|[^\s()<>]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\))/g;

/** Relative path from directory `fromDir` to `toPath`, both absolute. */
export function relativePathFrom(fromDir: string, toPath: string): string {
  const from = normalizePath(fromDir).split("/").filter(Boolean);
  const to = normalizePath(toPath).split("/").filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;
  return [...Array<string>(from.length - shared).fill(".."), ...to.slice(shared)].join("/");
}

function rebaseDestination(rawDest: string, fromDir: string, toDir: string): string {
  const dest = normalizeMarkdownDestination(rawDest);
  if (!dest || dest.startsWith("#") || dest.startsWith("/") || EXPLICIT_URL_SCHEME.test(dest)) {
    return rawDest;
  }
  const hashIndex = dest.indexOf("#");
  const pathPart = hashIndex === -1 ? dest : dest.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : dest.slice(hashIndex);
  const absolute = normalizePath(`${fromDir}/${normalizeLocalMarkdownDestination(pathPart)}`);
  return formatMarkdownDestination(relativePathFrom(toDir, absolute) + fragment);
}

/** Rewrite relative link and image destinations in `text` so they still point
 *  at the same files after moving from a note in `fromDir` to one in `toDir`.
 *  URLs, absolute paths, bare anchors, and fenced code are left alone. */
export function rebaseMarkdownLinks(text: string, fromDir: string, toDir: string): string {
  if (normalizePath(fromDir) === normalizePath(toDir)) return text;
  let fence: string | null = null;
  return text
    .split("\n")
    .map((line) => {
      const fenceMatch = FENCE.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1]!;
        if (fence === null) fence = marker[0]!.repeat(marker.length);
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        return line;
      }
      if (fence !== null) return line;
      return line.replace(
        INLINE_LINK,
        (_, open: string, dest: string, close: string) =>
          `${open}${rebaseDestination(dest, fromDir, toDir)}${close}`,
      );
    })
    .join("\n");
}
