import { HugeiconsIcon } from "@hugeicons/react";
import { SidebarRightIcon } from "@hugeicons/core-free-icons";
import { toggleCalendarPanel, useCalendarPanelVisible } from "@/hooks/use-calendar-panel";

/** The calendar panel's toggle: the sidebar toggle's mirror image. */
export function CalendarToggleButton() {
  const isVisible = useCalendarPanelVisible();
  const label = isVisible ? "Hide calendar" : "Show calendar";

  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggleCalendarPanel}
      aria-label={label}
      title={`${label} (⌘])`}
      className="flex h-[var(--chrome-control-height)] w-7 items-center justify-center rounded-lg text-[var(--text-icon-muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--text-secondary)]"
    >
      <HugeiconsIcon icon={SidebarRightIcon} size={18} color="currentColor" strokeWidth={2} />
    </button>
  );
}
