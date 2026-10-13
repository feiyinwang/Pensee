import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { useOpenCommandPalette } from "@/hooks/use-command-palette";

// Sits at the right end of the wordmark row. The negative margins keep the
// 28px hit area from growing the row and put the glyph's right edge on the
// tree's right edge.
export function SidebarSearchButton() {
  const openCommandPalette = useOpenCommandPalette();

  return (
    <button
      type="button"
      data-sidebar-search-button
      onClick={() => openCommandPalette()}
      aria-label="Search"
      title="Search (⌘P)"
      className="-my-1.5 -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-icon-muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--text-secondary)]"
    >
      <HugeiconsIcon icon={Search01Icon} size={16} color="currentColor" strokeWidth={2} />
    </button>
  );
}
