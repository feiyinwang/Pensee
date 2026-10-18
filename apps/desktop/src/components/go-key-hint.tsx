import { useUIStore } from "@/stores/ui-store";
import { goKeyPlaces } from "@/lib/spaces";
import { useSidebar } from "@/hooks/use-sidebar";

/** Same box as the sidebar rows' letters (sidebar-spaces.tsx): one meaning, one look. */
const KEYCAP =
  "flex h-[18px] min-w-[18px] items-center justify-center rounded-[var(--radius-button)] bg-[var(--color-bg-kbd)] px-1 font-[inherit] text-caption text-[var(--color-text-primary)]";

/**
 * While ⌘G waits for its letter, each sidebar row shows its letter in a box
 * (sidebar-spaces.tsx). With the sidebar hidden there is nothing to look at,
 * so this tray at the bottom centre, just above the note footer (44px, word
 * counts and pen keys), names the letters instead, out of the
 * way of the tabs and title at the top. It is Arc's floating button group
 * (uiarc.dev): a raised tray with a hairline edge, a short rule between the
 * chord and its places. No motion: it answers a key press
 * (SPECs/obsidian-shortcuts-spec.md#the-system).
 */
export function GoKeyHint() {
  const pending = useUIStore((s) => s.goKeyPending);
  const { isSidebarVisible } = useSidebar();
  if (!pending || isSidebarVisible) return null;
  return (
    <div
      role="status"
      data-go-key-hint
      className="pointer-events-none fixed bottom-14 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-[var(--radius-menu)] border border-[var(--color-border-floating)] bg-[var(--color-bg-popover)] p-1 text-caption text-[var(--color-text-primary)] shadow-[var(--shadow-popover)]"
    >
      <span className="flex h-[30px] items-center gap-1 px-2 text-[var(--color-text-muted)]">
        <kbd className={KEYCAP}>⌘</kbd>
        <kbd className={KEYCAP}>G</kbd>
        then
      </span>
      <span aria-hidden className="mx-1 h-4 w-px bg-[var(--color-border-default)]" />
      {goKeyPlaces().map((place) => (
        <span key={place.key} className="flex h-[30px] items-center gap-1.5 px-2">
          <kbd className={KEYCAP}>{place.key.toUpperCase()}</kbd>
          {place.name}
        </span>
      ))}
    </div>
  );
}
