import { useCallback } from "react";
import { applyPathChange as applyPathChangeFor } from "@/lib/file-actions";
import * as tauri from "@/lib/tauri";
import type { DirEntry } from "@/types/fs";
import { canMoveInto, computeMovePath } from "./tree-move";

export type MoveOutcome =
  | { status: "moved"; entry: DirEntry; newPath: string }
  | { status: "skipped"; entry: DirEntry }
  | { status: "exists"; entry: DirEntry; newPath: string }
  | { status: "error"; entry: DirEntry; error: unknown };

/**
 * The single write path for relocating a file or folder. Both inline rename and
 * drag-to-move funnel through here so on-disk renames and the corresponding
 * editor/workspace state rewrites stay in lockstep.
 */
export function useMoveEntry() {
  // Rename or move `entry` to `newPath` (lib/file-actions.ts): the name
  // (rename) or the parent (move) may differ — the handling is identical.
  const applyPathChange = useCallback(
    (entry: DirEntry, newPath: string): Promise<void> =>
      applyPathChangeFor(entry.path, newPath, entry.is_dir),
    [],
  );

  // Move `entry` into `destDir`, preserving its name. Returns an outcome instead
  // of alerting so callers can batch many moves and surface a single summary.
  const moveEntry = useCallback(
    async (entry: DirEntry, destDir: string): Promise<MoveOutcome> => {
      if (!canMoveInto(entry.path, entry.is_dir, destDir)) {
        return { status: "skipped", entry };
      }
      const newPath = computeMovePath(entry, destDir);
      if (await tauri.fileExists(newPath)) {
        return { status: "exists", entry, newPath };
      }
      try {
        await applyPathChange(entry, newPath);
        return { status: "moved", entry, newPath };
      } catch (error) {
        return { status: "error", entry, error };
      }
    },
    [applyPathChange],
  );

  return { applyPathChange, moveEntry };
}
