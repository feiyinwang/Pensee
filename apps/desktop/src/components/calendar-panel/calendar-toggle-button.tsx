import { HugeiconsIcon } from "@hugeicons/react";
import { SidebarRightIcon } from "@hugeicons/core-free-icons";
import { toggleCalendarPanel, useCalendarPanelVisible } from "@/hooks/use-calendar-panel";
import { useChromeTooltip } from "@/components/chrome-tooltip";

/** The calendar panel's toggle: the sidebar toggle's mirror image. */
export function CalendarToggleButton() {
  const isVisible = useCalendarPanelVisible();
  const label = isVisible ? "Hide calendar" : "Show calendar";
  const { triggerProps, tooltip } = useChromeTooltip(label, { keys: ["⌘", "]"] });

  return (
    <>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggleCalendarPanel}
        aria-label={label}
        aria-keyshortcuts="Meta+]"
        {...triggerProps}
        className="flex h-[var(--chrome-control-height)] w-7 items-center justify-center rounded-lg text-[var(--text-icon-muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--text-secondary)]"
      >
        <HugeiconsIcon icon={SidebarRightIcon} size={18} color="currentColor" strokeWidth={2} />
      </button>
      {tooltip}
    </>
  );
}
