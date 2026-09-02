import { getCurrentWebview } from "@tauri-apps/api/webview";

export const ZOOM_SETTING_KEY = "appearance.zoom";
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 300;
export const ZOOM_DEFAULT = 100;

/** Browser-style zoom stops, in percent. Keyboard steps snap onto this from
 *  wherever the slider left the value, so 96 goes to 100 and then 110. */
export const ZOOM_LADDER = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300] as const;

export function clampZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)));
}

/** Next ladder stop above (`direction > 0`) or below the current level; the
 *  current level itself when it already sits at that end of the ladder. */
export function stepZoom(current: unknown, direction: 1 | -1): number {
  const level = clampZoom(current);
  if (direction > 0) {
    return ZOOM_LADDER.find((stop) => stop > level) ?? level;
  }
  for (let i = ZOOM_LADDER.length - 1; i >= 0; i--) {
    const stop = ZOOM_LADDER[i]!;
    if (stop < level) return stop;
  }
  return level;
}

let appliedZoom: number | null = null;

/** Push the persisted level to the webview's page zoom. Runs with every other
 *  settings side effect, so it must be cheap when nothing changed. */
export function applyZoom(settings: Record<string, unknown>) {
  const level = clampZoom(settings[ZOOM_SETTING_KEY]);
  if (level === appliedZoom) return;
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  appliedZoom = level;
  getCurrentWebview()
    .setZoom(level / 100)
    .catch((error: unknown) => {
      appliedZoom = null;
      console.error("[zoom] setZoom failed", error);
    });
}
