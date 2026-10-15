import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Folder01Icon,
  Layers01Icon,
  LibraryIcon,
  Sun03Icon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import { openTodaysNote } from "@/hooks/use-daily-note";
import { openSpace, spaceLocationOf, useActiveSpaceKey, useSpaces } from "@/hooks/use-spaces";
import type { SpaceIcon } from "@/lib/spaces";
import { SIDEBAR_SECTION_LABEL_CLASS } from "./sidebar-section";

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
  onClick,
}: {
  icon: IconSvgElement;
  label: string;
  spaceKey?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-space-key={spaceKey}
      className={rowClass(active)}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
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
    </button>
  );
}

/** Today, then the spaces (SPECs/spaces-spec.md). */
export function SidebarSpaces() {
  const spaces = useSpaces();
  const activeKey = useActiveSpaceKey();

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
        <Row icon={Sun03Icon} label="Today" onClick={openToday} />
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
              onClick={() => openSpace(spaceLocationOf(space))}
            />
          ))}
        </div>
      </section>
    </>
  );
}
