import type { MouseEventHandler } from "react";
import { useRefreshDirectory } from "@/hooks/use-file-tree";
import { openFilesSpace, startFileTreeRename } from "@/hooks/use-spaces";
import { useBooleanSetting, useSetSetting } from "@/hooks/use-settings";
import { useWorkspaceRoot } from "@/hooks/use-workspace";
import { getWorkspaceIdentity, isCurrentWorkspaceIdentity } from "@/hooks/workspace-api";
import * as tauri from "@/lib/tauri";
import { createSidebarEntryAndRename } from "./create-sidebar-entry-and-rename";
import { showSidebarSurfaceContextMenu } from "./sidebar-surface-context-menu";
import { openSidebarDirectoryInTerminal } from "./sidebar-terminal-action";

export function useSidebarSurface() {
  const setSetting = useSetSetting();
  const showSearch = useBooleanSetting("appearance.sidebar-show-search");
  const showRecents = useBooleanSetting("appearance.sidebar-show-recents");
  const root = useWorkspaceRoot();
  const refreshDirectory = useRefreshDirectory();

  const createRootEntry = (kind: tauri.SidebarEntryKind) => {
    if (!root) return;
    const identity = getWorkspaceIdentity();
    void createSidebarEntryAndRename(kind, {
      // The tree lives in the Files space (SPECs/spaces-spec.md).
      expandParent: openFilesSpace,
      createEntry: (entryKind) => tauri.createSidebarEntry(root, entryKind),
      refreshRoot: () => refreshDirectory(root),
      startRenaming: startFileTreeRename,
      isCurrentWorkspace: () => isCurrentWorkspaceIdentity(identity),
    }).catch((error: unknown) => {
      window.alert(
        `Failed to create ${kind}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };

  const runWorkspaceAction = (label: string, action: () => Promise<void>) => {
    void action().catch((error: unknown) => {
      window.alert(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const onContextMenu: MouseEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    void showSidebarSurfaceContextMenu({
      showSearch,
      showRecents,
      workspaceActions: root
        ? {
            onNewFile: () => createRootEntry("file"),
            onNewFolder: () => createRootEntry("folder"),
            onOpenInTerminal: () => {
              void openSidebarDirectoryInTerminal(null);
            },
            onOpenInFileManager: () =>
              runWorkspaceAction(
                "Failed to open workspace folder",
                tauri.openWorkspaceInFileManager,
              ),
          }
        : null,
      onToggleSearch: (visible) => {
        void setSetting("appearance.sidebar-show-search", visible);
      },
      onToggleRecents: (visible) => {
        void setSetting("appearance.sidebar-show-recents", visible);
      },
    });
  };

  return {
    hasWorkspace: root !== null,
    onContextMenu,
  };
}
