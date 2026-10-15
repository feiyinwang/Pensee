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
import { spaceForShortcut } from "@/lib/spaces";

function isEditableTargetFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true;
  if ((active as HTMLElement).isContentEditable) return true;
  // CodeMirror editors render a contenteditable inside .cm-editor
  return active.closest(".cm-editor") !== null;
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Read current state at event time
      const { openCommandPalette } = useUIStore.getState();
      const { root, chromeMode } = useWorkspaceStore.getState();
      const { tabs, activeTabId, setActiveTab, closeActiveTab, navigateBack, navigateForward } =
        useEditorStore.getState();
      const isCompactFileMode = getWorkspaceChromeMode(root, chromeMode) === "compact-file";

      // Alt+Arrow: history navigation when no editable target is focused and
      // the focused control didn't take the key (a kanban card moves with it);
      // inside the editor, let CodeMirror handle word-wise cursor motion.
      const historyKey =
        e.altKey && !e.shiftKey && !e.defaultPrevented && !isEditableTargetFocused();
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

      // Cmd+P / Cmd+L / Cmd+O — open a built-in space, as its sidebar row
      // does (the letter lives on the space's def). A video note's ⌘S pin and
      // the editor's own keys run before this, on the document.
      if (mod && !e.altKey && !e.shiftKey) {
        const space = spaceForShortcut(e.key);
        if (space) {
          e.preventDefault();
          if (isCompactFileMode || !root) return;
          openSpace(spaceLocationOf(space));
          return;
        }
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

      // Cmd+F — unified search (files + commands). Find in the note is
      // Cmd+Shift+F, in the editor's own keymap.
      if (mod && !e.shiftKey && e.key === "f") {
        e.preventDefault();
        if (root) openCommandPalette("search");
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

      // Cmd+Shift+N — the composer, dated today: the text goes into today's
      // note (Enter with no text just opens it). Shift uppercases `key`, so
      // this must be tested before the Cmd+N branch.
      if (mod && e.shiftKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        openComposer({ today: true });
        return;
      }

      // Cmd+Shift+L — the composer, ready for Library. The composer needs a
      // workspace to file into and is inert in compact windows.
      if (mod && e.shiftKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        openComposer({ library: true });
        return;
      }

      // Cmd+N — the composer; a compact window (no workspace to file into)
      // keeps the palette's create field.
      if (mod && e.key === "n") {
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

      // Cmd+1 through Cmd+9 — jump to Nth tab
      if (mod && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        if (isCompactFileMode) return;
        const n = parseInt(e.key) - 1;
        if (n < tabs.length) {
          setActiveTab(tabs[n]!.id);
        }
        return;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
