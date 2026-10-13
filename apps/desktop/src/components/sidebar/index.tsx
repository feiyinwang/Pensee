import { FileBrowser } from "./file-browser";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { useWorkspaceGeneration } from "@/hooks/use-workspace";
import { useSidebarSurface } from "./use-sidebar-surface";

export function Sidebar() {
  const workspaceGeneration = useWorkspaceGeneration();

  return <SidebarSurface key={workspaceGeneration} />;
}

function SidebarSurface() {
  const surface = useSidebarSurface();

  return (
    <div
      data-sidebar-surface
      data-workspace-open={surface.hasWorkspace ? "true" : "false"}
      className="relative h-full overflow-hidden"
      onContextMenu={surface.onContextMenu}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-px bottom-px w-px bg-[var(--sidebar-divider-right)]"
      />
      <div className="flex h-full flex-col overflow-hidden">
        <div
          data-sidebar-surface-top
          data-tauri-drag-region
          className="shrink-0"
          style={{
            height: "calc(var(--chrome-control-height) + var(--chrome-control-padding) * 2)",
          }}
        />
        {/* The wordmark (docs/brand.md): its own row under the window buttons,
            on the Search field's left edge. Part of the drag region, so the
            text ignores the pointer. The -0.34em margin keeps the last
            letter's tracking from pushing the right edge out. */}
        <div data-sidebar-wordmark data-tauri-drag-region className="shrink-0 px-3 pt-1 pb-4">
          <span className="pointer-events-none block w-fit select-none font-[family-name:var(--display-font)] text-[16px] font-normal uppercase leading-none tracking-[0.34em] -mr-[0.34em] text-[var(--fg-base)]">
            Pensée
          </span>
        </div>
        <div data-sidebar-surface-content className="min-h-0 flex-1 overflow-hidden">
          <FileBrowser />
        </div>
        <div data-sidebar-surface-bottom className="shrink-0 px-3 py-3">
          <WorkspaceSwitcher />
        </div>
      </div>
    </div>
  );
}
