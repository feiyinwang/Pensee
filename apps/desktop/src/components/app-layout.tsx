import { useCallback, useRef, useState } from "react";
import { Sidebar } from "./sidebar";
import { EditorArea } from "./editor-area";
import { EditorTabs } from "./editor-area/editor-tabs";
import { SidebarToggleButton } from "./sidebar/sidebar-toggle-button";
import { CompactFileLayout } from "./compact-file-layout";
import { WelcomeScreen } from "./welcome";
import { useSidebar } from "@/hooks/use-sidebar";
import { useWorkspaceChromeMode, useWorkspaceRoot } from "@/hooks/use-workspace";
import { resolveAppView } from "@/lib/app-view";

// The sidebar edge is gesture-driven (drag to resize), so its post-release
// settle runs on the spring rather than the ease-out used for click-driven
// motion. The collapse toggle shares the curve so the edge always moves the
// same way. Tokens live in App.css (see docs/motion.md).
const TRAFFIC_LIGHTS_CLEARANCE = 92;
const SIDEBAR_EDGE_INSET = 12;
/** Matches the button's `w-7`. */
const TOGGLE_WIDTH = 28;

function sidebarSettleTransition(property: "width" | "left") {
  return `${property} var(--motion-settle) var(--ease-spring)`;
}

function clampSidebarWidth(width: number, maxSidebarWidth: number) {
  return Math.max(220, Math.min(maxSidebarWidth, Math.round(width)));
}

export function AppLayout() {
  const root = useWorkspaceRoot();
  const chromeMode = useWorkspaceChromeMode();
  const appView = resolveAppView(root, chromeMode);
  if (appView === "compact-file") {
    return <CompactFileLayout />;
  }

  return <WorkspaceLayout showWelcome={appView === "workspace-welcome"} />;
}

function WorkspaceLayout({ showWelcome }: { showWelcome: boolean }) {
  const { isSidebarCollapsed, sidebarWidth, setSidebarWidth } = useSidebar();
  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const maxSidebarWidth = Math.max(280, Math.min(420, Math.floor(viewportWidth * 0.35)));
  const draggingRef = useRef(false);
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);
  const [draftSidebarWidth, setDraftSidebarWidth] = useState(() =>
    clampSidebarWidth(sidebarWidth, maxSidebarWidth),
  );
  const draftSidebarWidthRef = useRef(draftSidebarWidth);
  // The toggle lives inside the sidebar's header, flush against its right
  // edge, so it sits on the edge it controls and rides along on drag. With
  // the sidebar collapsed there is no header, so it drops in beside the
  // traffic lights and the tab chrome starts after it.
  const toggleLeft = isSidebarCollapsed
    ? TRAFFIC_LIGHTS_CLEARANCE
    : draftSidebarWidth - SIDEBAR_EDGE_INSET - TOGGLE_WIDTH;
  const tabChromeLeft = isSidebarCollapsed
    ? TRAFFIC_LIGHTS_CLEARANCE + TOGGLE_WIDTH + 4
    : draftSidebarWidth + SIDEBAR_EDGE_INSET;

  const setClampedSidebarWidth = useCallback(
    (nextWidth: number) => {
      const next = clampSidebarWidth(nextWidth, maxSidebarWidth);
      draftSidebarWidthRef.current = next;
      setDraftSidebarWidth(next);
      return next;
    },
    [maxSidebarWidth],
  );

  if (!draggingRef.current) {
    const nextWidth = clampSidebarWidth(sidebarWidth, maxSidebarWidth);
    if (draftSidebarWidth !== nextWidth) {
      draftSidebarWidthRef.current = nextWidth;
      setDraftSidebarWidth(nextWidth);
    }
  }

  const handleSidebarResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      draggingRef.current = true;
      setIsSidebarDragging(true);

      const startX = event.clientX;
      const startWidth = draftSidebarWidthRef.current;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.documentElement.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        document.documentElement.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        setIsSidebarDragging(false);
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setClampedSidebarWidth(startWidth + moveEvent.clientX - startX);
      };

      const finishDrag = (shouldPersist: boolean) => {
        cleanup();
        draggingRef.current = false;

        const nextWidth = draftSidebarWidthRef.current;
        if (shouldPersist && nextWidth !== sidebarWidth) {
          void setSidebarWidth(nextWidth);
          return;
        }

        const syncedWidth = clampSidebarWidth(sidebarWidth, maxSidebarWidth);
        draftSidebarWidthRef.current = syncedWidth;
        setDraftSidebarWidth(syncedWidth);
      };

      const handlePointerUp = () => {
        finishDrag(true);
      };

      const handlePointerCancel = () => {
        finishDrag(false);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
    },
    [maxSidebarWidth, setClampedSidebarWidth, setSidebarWidth, sidebarWidth],
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-transparent text-text-primary">
      <div
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 z-30"
        style={{
          height: "var(--chrome-drag-height)",
          left: isSidebarCollapsed ? 0 : draftSidebarWidth,
        }}
      />
      <div
        className="pointer-events-none absolute top-0 z-50 flex items-center"
        style={{
          left: toggleLeft,
          height: "calc(var(--chrome-control-height) + var(--chrome-control-padding) * 2)",
          paddingBlock: "var(--chrome-control-padding)",
          transition: isSidebarDragging ? "none" : sidebarSettleTransition("left"),
        }}
      >
        <div className="pointer-events-auto">
          <SidebarToggleButton />
        </div>
      </div>
      {!showWelcome && (
        <div
          className="pointer-events-none absolute top-0 z-40"
          style={{
            left: tabChromeLeft,
            right: 12,
            transition: isSidebarDragging ? "none" : sidebarSettleTransition("left"),
          }}
        >
          <div className="pointer-events-auto">
            <EditorTabs />
          </div>
        </div>
      )}
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1">
          <div
            className="shrink-0 overflow-hidden"
            style={{
              width: isSidebarCollapsed ? 0 : draftSidebarWidth,
              transition: isSidebarDragging ? "none" : sidebarSettleTransition("width"),
            }}
          >
            <div style={{ width: draftSidebarWidth }} className="h-full">
              <Sidebar />
            </div>
          </div>
          {!isSidebarCollapsed && (
            <div
              role="presentation"
              aria-hidden="true"
              data-dragging={isSidebarDragging || undefined}
              onPointerDown={handleSidebarResizeStart}
              className="relative w-0 shrink-0 cursor-col-resize before:absolute before:inset-y-0 before:-left-1 before:w-2 before:content-[''] after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-transparent after:transition-colors after:content-[''] hover:after:bg-[var(--line-subtle)] data-[dragging]:after:bg-[var(--border-color)]"
            />
          )}

          <div className="relative min-w-0 flex-1 bg-bg">
            {showWelcome ? <WelcomeScreen /> : <EditorArea />}
          </div>
        </div>
      </div>
    </div>
  );
}
