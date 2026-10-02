import { getFileName } from "@/lib/paths";
import { definePageKind } from "./types";

/**
 * `path` is the focused page. `stack`, when present, is every page shown side
 * by side in left-to-right order (it always contains `path` and has at least
 * two entries); a single page has no `stack`. See SPECs/stacked-pages-spec.md.
 */
export type FileLocation = { kind: "file"; path: string; stack?: string[] };

/** Pages a file location shows, left to right. */
export function stackOf(location: FileLocation): string[] {
  return location.stack ?? [location.path];
}

/** Build a location from a page list and the focused page, collapsing a
 *  one-page stack. Returns `null` for an empty list. A `focus` that is not in
 *  the list falls back to the page nearest `fallbackIndex`. */
export function fileLocationFrom(
  pages: string[],
  focus: string,
  fallbackIndex = 0,
): FileLocation | null {
  const unique = [...new Set(pages)];
  if (unique.length === 0) return null;
  const path = unique.includes(focus)
    ? focus
    : unique[Math.min(Math.max(fallbackIndex, 0), unique.length - 1)]!;
  return unique.length === 1 ? { kind: "file", path } : { kind: "file", path, stack: unique };
}

function rewriteFileLocation(l: FileLocation, from: string, to: string): FileLocation | null {
  if (!l.stack) return l.path === from ? { ...l, path: to } : l;
  if (!l.stack.includes(from)) return l;
  const stack = l.stack.map((p) => (p === from ? to : p));
  return fileLocationFrom(stack, l.path === from ? to : l.path);
}

function removeFromFileLocation(l: FileLocation, path: string): FileLocation | null {
  const stack = stackOf(l);
  const index = stack.indexOf(path);
  if (index === -1) return l;
  // Losing the focused page hands focus to its left neighbour (or the new
  // first page), the column the eye was most likely reading before it.
  return fileLocationFrom(
    stack.filter((p) => p !== path),
    l.path === path ? "" : l.path,
    index - 1,
  );
}

// Behavior only — the view (EditorPane body + DocumentFooter chrome) is
// registered in `./views` so the data layer never imports the editor UI.
export const fileKind = definePageKind<"file", FileLocation>({
  kind: "file",
  title: (l) => getFileName(l.path),
  description: "Open file",
  keepAlive: true,
  supportsFileContextMenu: true,
  fromPayload: (data) => {
    if (typeof data.path !== "string") return null;
    const stack = Array.isArray(data.stack)
      ? data.stack.filter((p): p is string => typeof p === "string")
      : [];
    return fileLocationFrom(stack.includes(data.path) ? stack : [data.path], data.path);
  },
  paths: (l) => stackOf(l),
  primaryPath: (l) => l.path,
  rewritePath: rewriteFileLocation,
  removePath: removeFromFileLocation,
  serialize: (l) => (l.stack ? { path: l.path, stack: l.stack } : { path: l.path }),
});
