export type Platform = "macos" | "windows" | "linux";

/** Detect the desktop platform from the webview user agent. */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "linux";
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/i.test(ua)) return "macos";
  if (/Win/i.test(ua)) return "windows";
  return "linux";
}

/** Read once: the webview never changes platform. */
const PLATFORM = detectPlatform();
export const IS_MAC = PLATFORM === "macos";

/**
 * Room the top-left chrome leaves for the window buttons. macOS draws its
 * traffic lights over the content (an overlay title bar); Windows and Linux
 * keep a native title bar above it, so only the edge inset is left. Mirrored
 * by `--window-controls-inset` in App.css.
 */
export const WINDOW_CONTROLS_INSET = IS_MAC ? 92 : 12;

/** The command modifier alone: ⌘ on macOS, Ctrl elsewhere. */
export function isModKey(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/**
 * A trackpad pinch, which webviews send as a Ctrl-wheel with small deltas.
 * On macOS every Ctrl-wheel is one. On Windows a mouse's Ctrl-wheel is too,
 * one notch of about 100px, and must zoom at the mouse-wheel rate instead.
 */
export function isPinchWheel(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaY: number;
}): boolean {
  if (!event.ctrlKey || event.metaKey) return false;
  return IS_MAC || Math.abs(event.deltaY) < 50;
}

const KEY_WORDS: Record<string, string> = {
  "⌘": "Ctrl",
  "⌃": "Ctrl",
  "⌥": "Alt",
  "⇧": "Shift",
  "↩": "Enter",
  "↵": "Enter",
  "⏎": "Enter",
  "⌫": "Backspace",
  "⌦": "Delete",
  "⎋": "Esc",
};

/**
 * A shortcut label as this platform writes it. Labels are written the macOS
 * way ("⌘⇧Z", "⌘ K"); on macOS they come back unchanged, elsewhere the
 * modifier glyphs become words joined by "+" ("Ctrl+Shift+Z").
 */
export function keyLabel(label: string, platform: Platform = PLATFORM): string {
  if (platform === "macos") return label;
  return label.replace(/(?:[⌘⌃⌥⇧]\s*)+(?:[↩↵⏎⌫⌦⎋]|[^\s⌘⌃⌥⇧])?/gu, (chord) => {
    const parts: string[] = [];
    for (const char of chord.replace(/\s+/g, "")) parts.push(KEY_WORDS[char] ?? char);
    // ⌘ and ⌃ both become Ctrl; say it once.
    return parts
      .filter((part, index) => part !== "Ctrl" || parts.indexOf("Ctrl") === index)
      .join("+");
  });
}
