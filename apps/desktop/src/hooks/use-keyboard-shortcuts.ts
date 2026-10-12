import { useEffect } from "react";
import { useUIStore } from "@/stores/ui-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useAgentStore } from "@/stores/agent-store";
import { toggleSidebar } from "@/hooks/use-sidebar";
import { openTodaysNote } from "@/hooks/use-daily-note";
import { resetZoom, zoomIn, zoomOut } from "@/hooks/use-zoom";
import { getWorkspaceChromeMode } from "@/lib/compact-mode";

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
      const {
        tabs,
        activeTabId,
        setActiveTab,
        openNewTab,
        closeActiveTab,
        navigateBack,
        navigateForward,
      } = useEditorStore.getState();
      const isCompactFileMode = getWorkspaceChromeMode(root, chromeMode) === "compact-file";

      // Alt+Arrow: history navigation when no editable target is focused;
      // inside the editor, let CodeMirror handle word-wise cursor motion.
      if (e.altKey && !e.shiftKey && e.key === "ArrowLeft" && !isEditableTargetFocused()) {
        e.preventDefault();
        void navigateBack();
        return;
      }

      if (e.altKey && !e.shiftKey && e.key === "ArrowRight" && !isEditableTargetFocused()) {
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

      // Cmd+P / Cmd+Shift+P — unified search (files + commands)
      if (mod && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        if (e.shiftKey || root) openCommandPalette("search");
        return;
      }

      // Cmd+W — close current tab
      if (mod && e.key === "w") {
        if (isCompactFileMode) return;
        e.preventDefault();
        if (activeTabId) closeActiveTab();
        return;
      }

      // Cmd+\, Cmd+[ or Cmd+] — toggle sidebar. The editor's indent pair
      // moved off Mod-[ / Mod-] to the shifted keys in `editorDefaultKeymap`
      // so these are the only thing the brackets do.
      if (mod && (e.key === "\\" || e.key === "[" || e.key === "]")) {
        e.preventDefault();
        if (isCompactFileMode) return;
        toggleSidebar();
        return;
      }

      // Cmd+Shift+N — create or open today's dated note.
      // Shift uppercases `key`, so this must be tested before the Cmd+N branch.
      if (mod && e.shiftKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        void openTodaysNote();
        return;
      }

      // Cmd+N — create new note
      if (mod && e.key === "n") {
        e.preventDefault();
        if (root) openCommandPalette("create-file");
        return;
      }

      // Cmd+O — go to file
      if (mod && e.key === "o") {
        e.preventDefault();
        if (root) openCommandPalette("search");
        return;
      }

      // Cmd+J — toggle the agent chat (workspace windows only)
      if (mod && !e.shiftKey && !e.altKey && e.key === "j") {
        e.preventDefault();
        if (isCompactFileMode || !root) return;
        useAgentStore.getState().toggle();
        return;
      }

      // Cmd+T — new tab
      if (mod && e.key === "t") {
        e.preventDefault();
        if (isCompactFileMode) return;
        if (root) openNewTab();
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
