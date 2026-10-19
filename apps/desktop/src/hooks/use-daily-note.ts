import { createDailyNoteDependencies, openDailyNote, openDatedNote } from "@/lib/daily-note";
import { periodNoteStem, type PeriodKind } from "@/lib/periodic-notes";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { noteTipEvent } from "@/components/tips/tips-store";

function dailyNoteFolder(): string {
  return useSettingsStore.getState().getSetting("workspace.daily-note-folder") ?? "";
}

/**
 * Create-or-open today's dated note. Reads the workspace root and the
 * `workspace.daily-note-folder` setting at call time so the global shortcut,
 * the new-tab button, and the command palette all act on current state without
 * subscribing to it. The single binding layer between the stores and
 * `openDailyNote`; every entry point goes through here.
 */
export async function openTodaysNote(): Promise<void> {
  const { root } = useWorkspaceStore.getState();
  const { openFile } = useEditorStore.getState();
  await openDailyNote(root, dailyNoteFolder(), createDailyNoteDependencies(openFile));
}

const PERIOD_LABELS: Record<PeriodKind, string> = {
  day: "the day's note",
  week: "the week's note",
  month: "the month's note",
  quarter: "the quarter's note",
  year: "the year's note",
};

/** Create-or-open the note for the `kind` period holding `date` (the calendar
 *  panel). `beside` opens it in a new column right of the active tab (Cmd+click). */
export async function openPeriodNote(kind: PeriodKind, date: Date, beside = false): Promise<void> {
  const { root } = useWorkspaceStore.getState();
  const { openFile, openFileBeside } = useEditorStore.getState();
  await openDatedNote(
    root,
    dailyNoteFolder(),
    `${periodNoteStem(kind, date)}.md`,
    PERIOD_LABELS[kind],
    createDailyNoteDependencies(beside ? openFileBeside : openFile),
  );
  if (kind !== "day") noteTipEvent("period-note-opened");
}
