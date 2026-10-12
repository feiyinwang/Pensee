import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { deleteFile } from "@/lib/file-actions";
import { getRelativePath } from "@/lib/paths";
import { revealPathInSidebar } from "@/lib/reveal-in-sidebar";
import { useEditorStore, type Tab } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { buildTabMenuItemsSpec, showNativeContextMenu } from "./editor-context-menu";
import { pageKind } from "./page-kinds";

/**
 * The right-click menu of a note's header — its tab in the tab bar or its
 * column's header — so both offer the same actions. Only file tabs have one;
 * returns false (no menu) for the rest. `onRename` puts that header's title
 * into edit mode.
 */
export function showTabMenu(tab: Tab, onRename: () => void): boolean {
  const kind = pageKind(tab.location);
  const filePath = kind.supportsFileContextMenu ? kind.primaryPath(tab.location) : null;
  if (!filePath) return false;
  const root = useWorkspaceStore.getState().root;
  const relative = root ? getRelativePath(filePath, root) : filePath;
  const editor = () => useEditorStore.getState();

  void showNativeContextMenu(
    buildTabMenuItemsSpec({
      onClose: () => editor().closeTab(tab.id),
      onCloseOthers: () => {
        for (const t of editor().tabs) if (t.id !== tab.id) editor().closeTab(t.id);
      },
      onCloseAll: () => {
        for (const id of editor().tabs.map((t) => t.id)) editor().closeTab(id);
      },
      onRevealInSidebar: () => {
        editor().setActiveTab(tab.id);
        void revealPathInSidebar(filePath, { showSidebar: true });
      },
      onCopyPath: () => void writeText(relative),
      onRename,
      onDelete: () => void deleteFile(filePath),
    }),
  );
  return true;
}
