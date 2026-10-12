import { getFileStem } from "@/lib/paths";
import { builtInSpace } from "@/lib/spaces";
import { definePageKind } from "./types";

/** `space`: a built-in space's key (SPECs/spaces-spec.md), or `"note"` with
 *  `path` for a space you added as a markdown note. */
export type SpaceLocation = { kind: "space"; space: string; path?: string };

// No primary path: the space note's own text is never what the tab edits.
// The view is registered in `./views`.
export const spaceKind = definePageKind<"space", SpaceLocation>({
  kind: "space",
  title: (l) => (l.path ? getFileStem(l.path) : (builtInSpace(l.space)?.name ?? "Space")),
  description: "Notes of one type",
  keepAlive: true,
  fromPayload: (data) => {
    if (typeof data.path === "string") return { kind: "space", space: "note", path: data.path };
    return typeof data.space === "string" && builtInSpace(data.space)
      ? { kind: "space", space: data.space }
      : null;
  },
  paths: (l) => (l.path ? [l.path] : []),
  rewritePath: (l, from, to) => (l.path === from ? { ...l, path: to } : l),
  removePath: (l, path) => (l.path === path ? null : l),
  serialize: (l) => (l.path ? { space: l.space, path: l.path } : { space: l.space }),
});

export function isSameSpace(a: SpaceLocation, b: SpaceLocation): boolean {
  return a.space === b.space && a.path === b.path;
}
