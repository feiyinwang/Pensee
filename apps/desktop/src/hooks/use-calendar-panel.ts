import { useSettingsStore } from "@/stores/settings-store";

/** Fixed width of the right-hand calendar panel; the layout reserves it and
 *  the agent launcher shifts left by it. */
export const CALENDAR_PANEL_WIDTH = 288;
/** The panel's side padding; its toggle sits on the inner edge of it. */
export const CALENDAR_PANEL_INSET = 12;

export function toggleCalendarPanel() {
  const isVisible = useSettingsStore.getState().settings["appearance.calendar-visible"] === true;
  void useSettingsStore.getState().setSetting("appearance.calendar-visible", !isVisible);
}

export function useCalendarPanelVisible(): boolean {
  return useSettingsStore(
    (state) => (state.settings["appearance.calendar-visible"] as boolean | undefined) ?? false,
  );
}
