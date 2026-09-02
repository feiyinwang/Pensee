import * as tauri from "@/lib/tauri";
import { resolveWikiEmbed } from "@/lib/wiki-links";

// Resolved embed targets, keyed by workspace root + note path + target.
// Positive-only: a hit means the file existed at that absolute path when we
// looked; misses re-probe on the next widget build so newly added files
// appear without an invalidation channel. Bounded in practice by the number
// of distinct embeds the user views in a session. Shared by the image and
// HTML embed widgets so one lookup serves both.
const embedResolutionCache = new Map<string, string>();

export async function resolveEmbedPath(
  target: string,
  workspaceRoot: string | null,
  currentFilePath: string | null,
): Promise<string | null> {
  const key = `${workspaceRoot ?? ""}\0${currentFilePath ?? ""}\0${target}`;
  const cached = embedResolutionCache.get(key);
  if (cached) return cached;
  const resolved = await resolveWikiEmbed(
    target,
    workspaceRoot,
    currentFilePath,
    tauri.fileExists,
    tauri.findFileByName,
  );
  if (resolved) embedResolutionCache.set(key, resolved);
  return resolved;
}
