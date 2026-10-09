import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { getWorkspaceChromeMode } from "@/lib/compact-mode";
export type { OpenFile, Tab, SessionTab } from "@/stores/editor-store";

export function getOpenFile(path: string) {
  return useEditorStore.getState().openFiles.get(path) ?? null;
}

export function getOpenFiles() {
  return useEditorStore.getState().openFiles;
}

/** Call `listener` whenever the set of open files or any file's content
 *  changes. Returns the unsubscribe. */
export function subscribeOpenFiles(listener: () => void) {
  return useEditorStore.subscribe((state, prev) => {
    if (state.openFiles !== prev.openFiles) listener();
  });
}

export function getActiveFilePath() {
  return useEditorStore.getState().activeFilePath;
}

export function closeFile(path: string) {
  useEditorStore.getState().closeFile(path);
}

export function closeActiveTab() {
  useEditorStore.getState().closeActiveTab();
}

export function markSaved(path: string, diskContent: string) {
  useEditorStore.getState().markSaved(path, diskContent);
}

export function updateContent(path: string, content: string) {
  useEditorStore.getState().updateContent(path, content);
}

export function updateCursorPos(path: string, pos: number) {
  useEditorStore.getState().updateCursorPos(path, pos);
}

export function updateScrollPos(path: string, pos: number) {
  useEditorStore.getState().updateScrollPos(path, pos);
}

export function updateFrontmatter(path: string, frontmatter: string | null) {
  useEditorStore.getState().updateFrontmatter(path, frontmatter);
}

export function reloadFromDisk(path: string, rawContent: string) {
  useEditorStore.getState().reloadFromDisk(path, rawContent);
}

export function navigateToFile(path: string) {
  return useEditorStore.getState().navigateToFile(path);
}

export function isFileOpenInTab(path: string) {
  return useEditorStore
    .getState()
    .tabs.some((tab) => tab.location.kind === "file" && tab.location.path === path);
}

/** Follow a link: workspace windows show the target as a tab (column)
 *  beside the current one, compact windows (one page, no tabs) navigate in
 *  place. */
export function openLinkedPage(toPath: string) {
  const { root, chromeMode } = useWorkspaceStore.getState();
  const store = useEditorStore.getState();
  if (getWorkspaceChromeMode(root, chromeMode) === "compact-file") {
    return store.navigateToFile(toPath);
  }
  return store.openFileBeside(toPath);
}

export function renameOpenFile(oldPath: string, newPath: string) {
  useEditorStore.getState().renameOpenFile(oldPath, newPath);
}

export function openFileInNewTab(path: string) {
  return useEditorStore.getState().openFileInNewTab(path);
}

export function removePathReferences(path: string) {
  useEditorStore.getState().removePathReferences(path);
}

export function removePathsWithPrefix(prefix: string) {
  useEditorStore.getState().removePathsWithPrefix(prefix);
}

export function rewritePathPrefix(oldPrefix: string, newPrefix: string) {
  useEditorStore.getState().rewritePathPrefix(oldPrefix, newPrefix);
}
