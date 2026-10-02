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

export function isPageInActiveTab(path: string) {
  const state = useEditorStore.getState();
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (tab?.location.kind !== "file") return false;
  return (tab.location.stack ?? [tab.location.path]).includes(path);
}

/** Follow a link from the page at `fromPath`: workspace windows open the
 *  target as a column beside it, compact windows (one page, no room for
 *  columns) navigate in place. */
export function openLinkedPage(fromPath: string, toPath: string) {
  const { root, chromeMode } = useWorkspaceStore.getState();
  const store = useEditorStore.getState();
  if (getWorkspaceChromeMode(root, chromeMode) === "compact-file" || !fromPath) {
    return store.navigateToFile(toPath);
  }
  return store.openStackedPage(fromPath, toPath);
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
