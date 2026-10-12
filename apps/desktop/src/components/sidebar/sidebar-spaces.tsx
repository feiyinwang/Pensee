import { useState, type FormEvent, type KeyboardEvent } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  Folder01Icon,
  Idea01Icon,
  Layers01Icon,
  LibraryIcon,
  Sun03Icon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { openTodaysNote } from "@/hooks/use-daily-note";
import {
  createSpaceNote,
  openSpace,
  spaceLocationOf,
  useActiveSpaceKey,
  useSpaces,
} from "@/hooks/use-spaces";
import { SPACE_VIEWS, type SpaceIcon, type SpaceView } from "@/lib/spaces";
import { SIDEBAR_SECTION_LABEL_CLASS } from "./sidebar-section";

const ICONS: Record<SpaceIcon, IconSvgElement> = {
  projects: Target02Icon,
  library: LibraryIcon,
  inspirations: Idea01Icon,
  files: Folder01Icon,
  space: Layers01Icon,
};

const VIEW_LABELS: Record<SpaceView, string> = {
  gallery: "Gallery",
  list: "List",
  cards: "Cards",
  files: "Files",
};

function rowClass(active: boolean) {
  return `group flex h-[32px] w-full items-center gap-1.5 overflow-hidden rounded-lg pl-[10px] pr-2 text-left text-[13px] leading-[1.15] text-[var(--fg-base)] ${
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
  const [adding, setAdding] = useState(false);

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
        <div className={`${SIDEBAR_SECTION_LABEL_CLASS} justify-between !pr-1`}>
          <span>Spaces</span>
          <button
            type="button"
            aria-label="Add space"
            title="Add space"
            aria-expanded={adding}
            onClick={() => setAdding((open) => !open)}
            className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--fg-base)]"
          >
            <HugeiconsIcon icon={Add01Icon} size={14} color="currentColor" strokeWidth={2} />
          </button>
        </div>
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
          {adding && <AddSpaceForm onDone={() => setAdding(false)} />}
        </div>
      </section>
    </>
  );
}

function AddSpaceForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [view, setView] = useState<SpaceView>("gallery");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setError("Enter a name first");
      return;
    }
    setBusy(true);
    createSpaceNote(name, type, view)
      .then(onDone)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setBusy(false);
      });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onDone();
    }
  };

  const inputClass =
    "h-7 w-full rounded-md border border-[var(--line-subtler)] bg-[var(--surface-input)] px-2 text-[13px] text-[var(--fg-base)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]";

  return (
    <form
      onSubmit={submit}
      onKeyDown={onKeyDown}
      className="mt-1 flex flex-col gap-2 rounded-lg border border-[var(--line-subtler)] bg-[var(--surface-card)] p-2.5"
    >
      <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
        Name
        <input
          className={inputClass}
          value={name}
          placeholder="Recipes"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the form opens because the user asked to type a name
          autoFocus
          aria-invalid={error !== null}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
        Shows notes with Type
        <input
          className={inputClass}
          value={type}
          placeholder={name.trim() || "Recipe"}
          onChange={(event) => {
            setType(event.target.value);
            setError(null);
          }}
        />
      </label>
      <SegmentedControl
        label="View"
        value={view}
        onValueChange={(value) => setView(value as SpaceView)}
        options={SPACE_VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
      />
      {error && (
        <div role="alert" className="text-[12px] text-[var(--text-error)]">
          {error}
        </div>
      )}
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={busy}
          className="h-7 flex-1 rounded-md bg-[var(--surface-input)] text-[12px] text-[var(--fg-base)] hover:bg-[var(--surface-selected)]"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onDone}
          className="h-7 flex-1 rounded-md text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
