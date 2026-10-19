import { useEffect } from "react";
import { useUIStore } from "@/stores/ui-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useAgentStore } from "@/stores/agent-store";
import { toggleSidebar } from "@/hooks/use-sidebar";
import { toggleCalendarPanel } from "@/hooks/use-calendar-panel";
import { openComposer } from "@/hooks/use-composer";
import { openTodaysNote } from "@/hooks/use-daily-note";
import { resetZoom, zoomIn, zoomOut } from "@/hooks/use-zoom";
import { openSpace, spaceLocationOf } from "@/hooks/use-spaces";
import { getWorkspaceChromeMode } from "@/lib/compact-mode";
import { goTargetForKey } from "@/lib/spaces";
import { noteTipEvent } from "@/components/tips/tips-store";

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
/** How long ⌘G waits for its letter. */
const GO_KEY_WAIT_MS = 1500;
const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt"]);

/** ⌘G alone (Ctrl+G off a Mac), by physical key. */
function isGoKey(e: KeyboardEvent): boolean {
  const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && !e.shiftKey && !e.altKey && e.code === "KeyG";
}

let goKeyTimer: number | undefined;
function setGoKeyPending(pending: boolean): void {
  window.clearTimeout(goKeyTimer);
  useUIStore.getState().setGoKeyPending(pending);
  if (pending) goKeyTimer = window.setTimeout(() => setGoKeyPending(false), GO_KEY_WAIT_MS);
}

/**
 * The go key: ⌘G, then T Today, P Projects, L Library, F Files. Captured on
 * the window, before the editor, so it works mid-sentence and the letter never
 * types. A board keeps ⌘G (group, as in Figma) and the find bar keeps it (find
 * next, as everywhere on macOS). While it waits, the next key is taken
 * whatever it is; Esc or any other key just ends the wait.
 */
function handleGoKey(e: KeyboardEvent): void {
  if (e.isComposing) return;
  if (useUIStore.getState().goKeyPending) {
    if (MODIFIER_KEYS.has(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    setGoKeyPending(false);
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = goTargetForKey(e.key);
    if (target) noteTipEvent("go-key");
    if (target === "today") void openTodaysNote();
    else if (target) openSpace(spaceLocationOf(target));
    return;
  }
  if (!isGoKey(e)) return;
  // A board keeps ⌘G (group); the find bar keeps it (find next, as macOS).
  if (document.activeElement?.closest(".wr-board-host, [data-search-overlay]")) return;
  e.preventDefault();
  e.stopPropagation();
  const { root, chromeMode } = useWorkspaceStore.getState();
  if (!root || getWorkspaceChromeMode(root, chromeMode) === "compact-file") return;
  setGoKeyPending(true);
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Read current state at event time
      const { openCommandPalette } = useUIStore.getState();
      const { root, chromeMode } = useWorkspaceStore.getState();
      const {
        tabs,
        activeTabId,
        setActiveTab,
        closeActiveTab,
        reopenClosedTab,
        navigateBack,
        navigateForward,
      } = useEditorStore.getState();
      const isCompactFileMode = getWorkspaceChromeMode(root, chromeMode) === "compact-file";

      // Cmd+Alt+Arrow — history navigation, as in Obsidian, also with the
      // caret in a note (plain Alt+Arrow there moves by word, and a board
      // or kanban card claims it for travel).
      const historyKey = mod && e.altKey && !e.shiftKey;
      if (historyKey && e.key === "ArrowLeft") {
        e.preventDefault();
        void navigateBack();
        return;
      }

      if (historyKey && e.key === "ArrowRight") {
        e.preventDefault();
        void navigateForward();
        return;
      }

      // Cmd+= / Cmd++, Cmd+- and Cmd+0 — window zoom. The board canvas binds
      // the same keys to its own viewport and only calls preventDefault, so
      // yield to it when it already handled the event.
      if (mod && !e.altKey && !e.defaultPrevented) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          zoomIn();
          return;
        }
        if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          zoomOut();
          return;
        }
        if (e.key === "0" && !e.shiftKey) {
          e.preventDefault();
          resetZoom();
          return;
        }
      }

      // Cmd+O finds a note and Cmd+Shift+F searches every note (Obsidian's
      // quick switcher and search); Cmd+P runs a command (Obsidian's command
      // palette). Cmd+F is find in the note, in the editor.
      if (
        mod &&
        !e.altKey &&
        ((!e.shiftKey && e.key === "o") || (e.shiftKey && (e.key === "f" || e.key === "F")))
      ) {
        e.preventDefault();
        if (root) openCommandPalette("search");
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        if (root) openCommandPalette("commands");
        return;
      }

      // Cmd+Shift+T — reopen the last tab you closed
      if (mod && e.shiftKey && !e.altKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        if (isCompactFileMode) return;
        void reopenClosedTab();
        return;
      }

      // Cmd+W — close current tab
      if (mod && e.key === "w") {
        if (isCompactFileMode) return;
        e.preventDefault();
        if (activeTabId) closeActiveTab();
        return;
      }

      // Cmd+\ or Cmd+[ — toggle the sidebar; Cmd+] — toggle the calendar
      // panel on the right. The editor's indent pair moved off Mod-[ / Mod-]
      // to the shifted keys in `editorDefaultKeymap` so these are the only
      // thing the brackets do.
      if (mod && !e.shiftKey && e.key === "]") {
        e.preventDefault();
        if (isCompactFileMode || !root) return;
        toggleCalendarPanel();
        return;
      }
      if (mod && (e.key === "\\" || e.key === "[")) {
        e.preventDefault();
        if (isCompactFileMode) return;
        toggleSidebar();
        return;
      }

      // Cmd+N — the composer; a compact window (no workspace to file into)
      // keeps the palette's create field. Its dated-today and Library
      // presets are commands in Cmd+P, and the composer's own chips.
      if (mod && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        if (!root) return;
        if (isCompactFileMode) openCommandPalette("create-file");
        else openComposer();
        return;
      }

      // Cmd+J — toggle the agent chat (workspace windows only)
      if (mod && !e.shiftKey && !e.altKey && e.key === "j") {
        e.preventDefault();
        if (isCompactFileMode || !root) return;
        useAgentStore.getState().toggle();
        return;
      }

      // Cmd+T — today's note, made if missing, as the sidebar's Today does.
      // A compact window has no daily-note folder to file it in.
      if (mod && !e.shiftKey && e.key === "t") {
        e.preventDefault();
        if (isCompactFileMode) return;
        void openTodaysNote();
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        if (isCompactFileMode) return;
        if (tabs.length === 0 || !activeTabId) return;
        const idx = tabs.findIndex((tab) => tab.id === activeTabId);
        if (idx === -1) return;
        const next = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
        setActiveTab(tabs[next]!.id);
        return;
      }

      // Cmd+1 through Cmd+8 — jump to Nth tab; Cmd+9 — the last tab
      if (mod && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        if (isCompactFileMode) return;
        const n = e.key === "9" ? tabs.length - 1 : parseInt(e.key) - 1;
        if (n >= 0 && n < tabs.length) {
          setActiveTab(tabs[n]!.id);
        }
        return;
      }
    }
    window.addEventListener("keydown", handleGoKey, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGoKey, true);
      window.removeEventListener("keydown", handleKeyDown);
      setGoKeyPending(false);
    };
  }, []);
}
