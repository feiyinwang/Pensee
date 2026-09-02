import { useSettingsStore } from "@/stores/settings-store";
import { ZOOM_DEFAULT, ZOOM_SETTING_KEY, stepZoom } from "@/lib/zoom";

// Keyboard, menu and slider all funnel into the one setting; `applyZoom`
// (run with the other settings side effects) is what reaches the webview.

function setZoomLevel(level: number) {
  void useSettingsStore.getState().setSetting(ZOOM_SETTING_KEY, level, "global");
}

export function zoomIn() {
  setZoomLevel(stepZoom(useSettingsStore.getState().settings[ZOOM_SETTING_KEY], 1));
}

export function zoomOut() {
  setZoomLevel(stepZoom(useSettingsStore.getState().settings[ZOOM_SETTING_KEY], -1));
}

export function resetZoom() {
  setZoomLevel(ZOOM_DEFAULT);
}
