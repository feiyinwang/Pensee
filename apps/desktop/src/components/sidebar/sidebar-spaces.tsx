import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Folder01Icon,
  Layers01Icon,
  LibraryIcon,
  Mic01Icon,
  Sun03Icon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import { useChromeTooltip } from "@/components/chrome-tooltip";
import { openTodaysNote } from "@/hooks/use-daily-note";
import { openSpace, spaceLocationOf, useActiveSpaceKey, useSpaces } from "@/hooks/use-spaces";
import { GO_TODAY_KEY, type SpaceIcon } from "@/lib/spaces";
import { useUIStore } from "@/stores/ui-store";
import { useEditorStore } from "@/stores/editor-store";
import { useOpenRecordingsTab } from "@/hooks/use-tabs";
import { SIDEBAR_SECTION_LABEL_CLASS } from "./sidebar-section";
import { IS_MAC } from "@/lib/platform";

const ICONS: Record<SpaceIcon, IconSvgElement> = {
  projects: Target02Icon,
  library: LibraryIcon,
  files: Folder01Icon,
  space: Layers01Icon,
};

function rowClass(active: boolean) {
  return `group flex h-[32px] w-full items-center gap-1.5 overflow-hidden rounded-lg pl-[10px] pr-2 text-left text-label leading-[1.15] text-[var(--fg-base)] ${
    active ? "bg-[var(--surface-subtle)]" : "hover:bg-[var(--surface-subtle)]"
  }`;
}

function Row({
  icon,
  label,
  spaceKey,
  active = false,
  tooltip,
  keys,
  keyshortcuts,
  goKey,
  onClick,
}: {
  icon: IconSvgElement;
  label: string;
  spaceKey?: string;
  active?: boolean;
  /** What the row does, shown on hover beside its shortcut. */
  tooltip?: string;
  /** The shortcut's keycaps (`["⌘", "T"]`). A row without one has no tooltip. */
  keys?: readonly string[];
  /** The shortcut for `aria-keyshortcuts` (`Meta+T`). */
  keyshortcuts?: string;
  /** The letter after ⌘G that opens this row, boxed on the row while ⌘G waits. */
  goKey?: string;
  onClick: () => void;
}) {
  const hint = useChromeTooltip(tooltip ?? label, { keys, side: "right" });
  const goKeyPending = useUIStore((s) => s.goKeyPending);

  return (
    <>
      <button
        type="button"
        data-space-key={spaceKey}
        className={rowClass(active)}
        aria-current={active ? "page" : undefined}
        aria-keyshortcuts={keyshortcuts}
        onClick={onClick}
        {...(keys ? hint.triggerProps : {})}
      >
        <span
          className={`flex w-5 shrink-0 items-center justify-center ${active ? "" : "opacity-60 group-hover:opacity-100"}`}
        >
          <HugeiconsIcon icon={icon} size={16} color="currentColor" strokeWidth={1.75} />
        </span>
        <span
          className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${active ? "" : "opacity-60 group-hover:opacity-100"}`}
        >
          {label}
        </span>
        {goKeyPending && goKey && (
          // No motion: it answers a key press.
          <kbd
            data-go-key={goKey}
            className="ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[var(--radius-button)] bg-[var(--color-bg-kbd)] px-1 font-[inherit] text-caption text-[var(--color-text-primary)]"
          >
            {goKey.toUpperCase()}
          </kbd>
        )}
      </button>
      {hint.tooltip}
    </>
  );
}

/** Today, then the spaces (SPECs/spaces-spec.md). */
export function SidebarSpaces() {
  const spaces = useSpaces();
  const activeKey = useActiveSpaceKey();
  const openRecordings = useOpenRecordingsTab();
  const recordingsActive = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.location.kind === "recordings";
  });

  const openToday = () => {
    void openTodaysNote().catch((error: unknown) => {
      window.alert(
        `Failed to open today's note: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };

  return (
    <>
      <div className="flex flex-col gap-px">
        <Row
          icon={Sun03Icon}
          label="Today"
          tooltip="Open today's note"
          keys={["⌘", "T"]}
          keyshortcuts={IS_MAC ? "Meta+T" : "Control+T"}
          goKey={GO_TODAY_KEY}
          onClick={openToday}
        />
      </div>
      <section className="flex flex-col gap-1" aria-label="Spaces">
        <div className={SIDEBAR_SECTION_LABEL_CLASS}>Spaces</div>
        <div className="flex flex-col gap-px">
          {spaces.map((space) => (
            <Row
              key={space.key}
              icon={ICONS[space.icon]}
              label={space.name}
              spaceKey={space.key}
              active={activeKey === space.key}
              tooltip={`Go to ${space.name}`}
              keys={space.goKey ? ["⌘", "G", space.goKey.toUpperCase()] : undefined}
              keyshortcuts={
                space.goKey
                  ? `${IS_MAC ? "Meta" : "Control"}+G ${space.goKey.toUpperCase()}`
                  : undefined
              }
              goKey={space.goKey}
              onClick={() => openSpace(spaceLocationOf(space))}
            />
          ))}
          <Row
            icon={Mic01Icon}
            label="Recordings"
            active={recordingsActive}
            onClick={openRecordings}
          />
        </div>
      </section>
    </>
  );
}
