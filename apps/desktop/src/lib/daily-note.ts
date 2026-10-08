import { getFileExtension, getFileStem, normalizePath } from "@/lib/paths";
import * as tauri from "@/lib/tauri";

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;

/**
 * The `YYYY-MM-DD` name for a day, read off the **local** calendar. Deliberately
 * not `toISOString()`, which is UTC: a note written at 23:30 must be named after
 * the day the writer is living in, not the day UTC has already rolled into.
 */
export function formatDailyNoteDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const DAILY_NOTE_NAME = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether `path` names a daily note: a `.md` file whose stem is exactly the
 * `YYYY-MM-DD` that `formatDailyNoteDate` produces. The date is the note's
 * identity, so it is also its title: a heading typed at the top of the day is
 * a section of the day, not a rename of it. Mirrored by `is_daily_note_name`
 * in `commands/fs.rs` for the sidebar index.
 */
export function isDailyNoteName(path: string): boolean {
  return getFileExtension(path).toLowerCase() === "md" && DAILY_NOTE_NAME.test(getFileStem(path));
}

export type DailyNotePath = { ok: true; path: string } | { ok: false; error: string };

/**
 * Resolve today's note path under `root`, honoring the configured folder.
 * A blank folder means the workspace root. A folder that would escape the
 * workspace is rejected rather than silently rewritten, so a typo in Preferences
 * cannot quietly start writing notes outside the vault.
 */
export function resolveDailyNotePath(root: string, folder: string, date: Date): DailyNotePath {
  return resolveDailyNoteFile(root, folder, `${formatDailyNoteDate(date)}.md`);
}

/** Where the daily note named `fileName` (`YYYY-MM-DD.md`) lives: the same
 *  folder rules as `resolveDailyNotePath`, for any day rather than one read off
 *  a clock. Pages created from a `[[YYYY-MM-DD]]` link go here too. */
export function resolveDailyNoteFile(
  root: string,
  folder: string,
  fileName: string,
): DailyNotePath {
  const trimmedFolder = folder.trim();
  const base = root.replace(/\/$/, "");

  if (!trimmedFolder) return { ok: true, path: `${base}/${fileName}` };

  // The field names a folder *inside* the workspace, so a leading slash reads as
  // "from the workspace root" (the vault convention) rather than as a filesystem
  // absolute path. Only a drive letter or a `..` that climbs out is a real escape.
  const relativeFolder = trimmedFolder.replace(/^[/\\]+/, "").replace(/[/\\]+$/, "");
  const normalizedFolder = normalizePath(relativeFolder);
  const escapesWorkspace =
    WINDOWS_ABSOLUTE_PATH.test(trimmedFolder) ||
    normalizedFolder === ".." ||
    normalizedFolder.startsWith("../");

  if (escapesWorkspace) {
    return {
      ok: false,
      error: `Daily Note Folder "${folder}" points outside the workspace. Set it to a folder inside the workspace, or clear it to use the workspace root.`,
    };
  }

  // An all-`.`/`./` value normalizes away to nothing — that is the root, not an error.
  if (!normalizedFolder) return { ok: true, path: `${base}/${fileName}` };

  return { ok: true, path: `${base}/${normalizedFolder}/${fileName}` };
}

export interface DailyNoteDependencies {
  /** Create the note from the new-file template when missing; open it either way. */
  createFileIfMissing: (path: string) => Promise<unknown>;
  openFile: (path: string) => Promise<void> | void;
  showError: (message: string) => void;
  now: () => Date;
}

const runtimeDependencies: Omit<DailyNoteDependencies, "openFile"> = {
  createFileIfMissing: (path) => tauri.createFileIfMissing(path),
  showError: (message) => window.alert(message),
  now: () => new Date(),
};

export function createDailyNoteDependencies(
  openFile: DailyNoteDependencies["openFile"],
): DailyNoteDependencies {
  return { ...runtimeDependencies, openFile };
}

/**
 * Create-or-open today's note. Idempotent by construction: the backend owns the
 * create-or-read decision, so pressing the shortcut a second time reopens the
 * same note instead of racing a second creation. This is the single frontend
 * owner of daily-note errors.
 */
export async function openDailyNote(
  root: string | null,
  folder: string,
  dependencies: DailyNoteDependencies,
): Promise<void> {
  // Matches Cmd+N: without a workspace there is nowhere for the note to live.
  if (!root) return;

  const resolved = resolveDailyNotePath(root, folder, dependencies.now());
  if (!resolved.ok) {
    dependencies.showError(`Failed to open today's note: ${resolved.error}`);
    return;
  }

  try {
    await dependencies.createFileIfMissing(resolved.path);
    await dependencies.openFile(resolved.path);
  } catch (error) {
    dependencies.showError(
      `Failed to open today's note: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
