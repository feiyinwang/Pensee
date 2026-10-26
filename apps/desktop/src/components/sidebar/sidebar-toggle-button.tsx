import { HugeiconsIcon } from "@hugeicons/react";
import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { useSidebar } from "@/hooks/use-sidebar";
import { useChromeTooltip } from "@/components/chrome-tooltip";
import { IS_MAC } from "@/lib/platform";

export function SidebarToggleButton() {
  const { isSidebarVisible, toggleSidebar } = useSidebar();
  const label = isSidebarVisible ? "Hide sidebar" : "Show sidebar";
  const { triggerProps, tooltip } = useChromeTooltip(label, { keys: ["⌘", "["] });

  // Styled as one of the tab chrome's history arrows: same height, width,
  // radius and muted-to-secondary hover, since it sits right beside them.
  return (
    <>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggleSidebar}
        aria-label={label}
        aria-keyshortcuts={IS_MAC ? "Meta+[" : "Control+["}
        {...triggerProps}
        className="flex h-[var(--chrome-control-height)] w-7 items-center justify-center rounded-lg text-[var(--text-icon-muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--text-secondary)]"
      >
        <HugeiconsIcon icon={SidebarLeftIcon} size={18} color="currentColor" strokeWidth={2} />
      </button>
      {tooltip}
    </>
  );
}
