import { createDailyNoteDependencies, openDailyNote } from "@/lib/daily-note";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

/**
 * Create-or-open today's dated note. Reads the workspace root and the
 * `workspace.daily-note-folder` setting at call time so the global shortcut,
 * the new-tab button, and the command palette all act on current state without
 * subscribing to it. The single binding layer between the stores and
 * `openDailyNote`; every entry point goes through here.
 */
export async function openTodaysNote(): Promise<void> {
  const { root } = useWorkspaceStore.getState();
  const folder = useSettingsStore.getState().getSetting("workspace.daily-note-folder") ?? "";
  const { openFile } = useEditorStore.getState();
  await openDailyNote(root, folder, createDailyNoteDependencies(openFile));
}
