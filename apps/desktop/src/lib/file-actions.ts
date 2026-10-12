import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { getFileName, getFileStem, getParentDir } from "./paths";
import * as tauri from "./tauri";

// Renaming and deleting a file or folder: the one write path behind the
// sidebar (inline rename, drag-to-move, Delete) and a note's header menu, so
// the disk and the editor/workspace state change together wherever it starts.

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Rename or move `path` to `newPath` on disk, then rewrite editor and
 *  workspace state and refresh both folders. Throws on failure. */
export async function applyPathChange(path: string, newPath: string, isDir: boolean) {
  await tauri.renameEntry(path, newPath);
  const editor = useEditorStore.getState();
  const workspace = useWorkspaceStore.getState();
  if (isDir) {
    editor.rewritePathPrefix(path, newPath);
    workspace.rewriteExpandedDir(path, newPath);
  } else {
    editor.renameOpenFile(path, newPath);
  }
  workspace.rewritePinnedPath(path, newPath);
  const fromParent = getParentDir(path);
  const toParent = getParentDir(newPath);
  await workspace.refreshDirectory(fromParent);
  if (toParent !== fromParent) await workspace.refreshDirectory(toParent);
}

/** The extension of a file name, dot included ("" for none or a dotfile). */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

/** Give file `path` the name `stem` (its extension kept). Says why in an
 *  alert when the name is taken or the rename fails. */
export async function renameFileStem(path: string, stem: string): Promise<void> {
  const trimmed = stem.trim();
  if (!trimmed || trimmed === getFileStem(path)) return;
  const ext = fileExtension(getFileName(path));
  const newPath = `${getParentDir(path)}/${trimmed}${ext}`;
  try {
    if (await tauri.fileExists(newPath)) {
      window.alert(`A file named "${trimmed}${ext}" already exists.`);
      return;
    }
    await applyPathChange(path, newPath, false);
  } catch (error) {
    window.alert(`Failed to rename: ${errorText(error)}`);
  }
}

/** Move file `path` to the Trash and drop it from tabs and pins. Asks first
 *  only when it has unsaved changes, which the Trash would not hold. */
export async function deleteFile(path: string): Promise<void> {
  if (useEditorStore.getState().openFiles.get(path)?.isDirty) {
    const confirmed = window.confirm(`"${getFileName(path)}" has unsaved changes. Delete anyway?`);
    if (!confirmed) return;
  }
  try {
    await tauri.deleteEntry(path);
    useEditorStore.getState().removePathReferences(path);
    const workspace = useWorkspaceStore.getState();
    workspace.removePinnedFile(path);
    await workspace.refreshDirectory(getParentDir(path));
  } catch (error) {
    window.alert(`Failed to delete: ${errorText(error)}`);
  }
}
