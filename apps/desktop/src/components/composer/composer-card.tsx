import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clapperboard,
  File,
  FileText,
  Folder,
  GraduationCap,
  Mic,
  Paperclip,
  X,
  type LucideIcon,
} from "lucide-react";
import { Calendar } from "@/components/arc/calendar/calendar";
import { DropdownMenu, type DropdownItem } from "@/components/arc/dropdown-menu/dropdown-menu";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/arc/popover/popover";
import { Switch } from "@/components/arc/switch/switch";
import { ensureArcTokens } from "@/components/editor-area/board/arc-tokens";
import { submitComposer, attachToComposer } from "@/hooks/use-composer";
import { useTypedNotes } from "@/hooks/use-spaces";
import {
  composerTarget,
  dayLabel,
  effectiveKind,
  fileTitle,
  headerLabel,
  submitLabel,
  withDay,
  withKind,
  type ComposerKind,
} from "@/lib/composer";
import { formatDailyNoteDate } from "@/lib/daily-note";
import {
  LIBRARY_KINDS,
  LIBRARY_KIND_LABELS,
  LIBRARY_NOTE_TYPES,
  parseLibraryLink,
} from "@/lib/library-add";
import { getFileName, getParentDir } from "@/lib/paths";
import * as tauri from "@/lib/tauri";
import { useComposerStore } from "@/stores/composer-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import "./composer.css";

// The composer card (SPECs/composer-spec.md): Linear's new-issue layout on
// Writer's card, with Arc controls. Lazy, so Arc and motion load on first use.

const NO_TYPES: readonly string[] = [];

/** Library's own icons (library-add-rows.tsx), so a kind looks the same everywhere. */
const KIND_ICONS: Record<ComposerKind, LucideIcon> = {
  note: File,
  book: BookOpen,
  video: Clapperboard,
  podcast: Mic,
  course: GraduationCap,
  paper: FileText,
};

const KIND_LABELS: Record<ComposerKind, string> = { note: "Note", ...LIBRARY_KIND_LABELS };

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** The vault's top-level folders, and the open note's own folder when it is
 *  deeper: the places a quick note usually goes. Vault-relative. */
function useFolders(): string[] {
  const root = useWorkspaceStore((s) => s.root);
  const entries = useWorkspaceStore((s) => (root ? s.directoryCache.get(root) : undefined));
  const activePath = useEditorStore((s) => s.activeFilePath);
  return useMemo(() => {
    if (!root) return [];
    const folders = (entries ?? [])
      .filter((entry) => entry.is_dir && !entry.name.startsWith("."))
      .map((entry) => entry.name);
    const activeDir = activePath ? getParentDir(activePath) : null;
    if (activeDir && activeDir.startsWith(`${root}/`)) {
      const relative = activeDir.slice(root.length + 1);
      if (!folders.includes(relative)) folders.push(relative);
    }
    return folders.sort((a, b) => a.localeCompare(b));
  }, [root, entries, activePath]);
}

export interface ComposerCardProps {
  /** `dialog` floats over the page (⌘T); `inline` is the New tab page. */
  variant: "dialog" | "inline";
  onClose?: () => void;
}

export default function ComposerCard({ variant, onClose }: ComposerCardProps) {
  ensureArcTokens();
  const draft = useComposerStore((s) => s.draft);
  const setDraft = useComposerStore((s) => s.setDraft);
  const keepOpen = useComposerStore((s) => s.keepOpen);
  const setKeepOpen = useComposerStore((s) => s.setKeepOpen);
  const busy = useComposerStore((s) => s.busy);
  const error = useComposerStore((s) => s.error);
  const focusTick = useComposerStore((s) => s.focusTick);
  const root = useWorkspaceStore((s) => s.root);
  const dailyFolder = useSettingsStore(
    (s) => (s.settings["workspace.daily-note-folder"] as string | undefined) ?? "",
  );
  const folders = useFolders();

  const kind = effectiveKind(draft);
  const isLink = kind !== "note" && !draft.file && parseLibraryLink(draft.title) !== null;
  // Library's notes are read only while a link could already be in it.
  const libraryNotes = useTypedNotes(isLink ? LIBRARY_NOTE_TYPES : NO_TYPES);
  const target = composerTarget(draft, isLink ? libraryNotes : null);
  const now = new Date();
  const label = submitLabel(target, Boolean(draft.body.trim()), now);
  const canSubmit = target.kind !== "empty" && !busy;

  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleLocked = Boolean(draft.day || draft.file);

  useEffect(() => {
    (titleLocked ? bodyRef.current : titleRef.current)?.focus();
    // Only a new focus request moves the caret, not a draft change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  // The body grows with its text up to its max height, then scrolls.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.style.height = "auto";
    body.style.height = `${body.scrollHeight}px`;
  }, [draft.body]);

  function submit() {
    if (canSubmit) void submitComposer(target);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  async function attach() {
    const path = await tauri.pickFile({ name: "Books", extensions: ["pdf", "epub"] });
    if (path) attachToComposer(path);
  }

  // Header: where it goes. Only a plain note picks its folder.
  const workspaceName = root ? getFileName(root) : "";
  const destination =
    draft.day !== null
      ? dailyFolder.replace(/^[/\\]+|[/\\]+$/g, "") || workspaceName
      : kind === "note"
        ? (draft.folder ?? workspaceName)
        : workspaceName;
  const folderItems: DropdownItem[] = [
    { label: workspaceName, onSelect: () => setDraft({ ...draft, folder: null }) },
    ...folders.map((folder, index) => ({
      label: folder,
      separatorBefore: index === 0,
      onSelect: () => setDraft({ ...draft, folder }),
    })),
  ];

  // Type chip. An attached file is a book or a paper; a PDF nobody picked a
  // kind for is read once it is in the vault.
  const kindLabel =
    draft.file && !draft.kindPicked && !/\.epub$/i.test(draft.file)
      ? "Book or paper"
      : KIND_LABELS[kind];
  const KindIcon = KIND_ICONS[kind];
  const kindItems: DropdownItem[] = (["note", ...LIBRARY_KINDS] as ComposerKind[]).map(
    (option, index) => {
      const Icon = KIND_ICONS[option];
      return {
        label: KIND_LABELS[option],
        icon: <Icon size={14} />,
        separatorBefore: index === 1,
        disabled: draft.file !== null && option !== "book" && option !== "paper",
        onSelect: () => setDraft(withKind(draft, option)),
      };
    },
  );

  const status = error ? (
    <span className="composer-status" role="alert">
      <span className="truncate">{error.message}</span>
      {error.path && (
        <button
          type="button"
          className="composer-link"
          onClick={() => {
            void useEditorStore.getState().openFile(error.path!);
            onClose?.();
          }}
        >
          Open it
        </button>
      )}
    </span>
  ) : target.kind === "link" && target.existing ? (
    <span className="composer-status">
      <span className="truncate">
        Already in your Library: {target.existing.title ?? target.existing.name}
      </span>
    </span>
  ) : null;

  return (
    <div className={`composer composer--${variant}`} onKeyDown={onKeyDown}>
      <header className="composer-header">
        {kind === "note" && !draft.day ? (
          <DropdownMenu
            label={destination}
            icon={<Folder size={14} />}
            items={folderItems}
            align="start"
          />
        ) : (
          <span
            className="composer-chip"
            aria-disabled="true"
            title={
              draft.day
                ? "Daily notes go in the daily-note folder"
                : "Library notes go in the vault"
            }
          >
            <Folder size={14} className="composer-chip-icon" aria-hidden />
            <span className="truncate">{destination}</span>
          </span>
        )}
        <ChevronRight size={14} className="shrink-0 text-[var(--text-icon-muted)]" aria-hidden />
        <h2 className="composer-heading">{headerLabel(kind, draft.day)}</h2>
        {variant === "dialog" && (
          <button
            type="button"
            className="composer-icon-button ml-auto"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        )}
      </header>

      <div className="composer-fields">
        {titleLocked ? (
          <p className="composer-title composer-title--locked">
            {draft.day ?? fileTitle(draft.file!)}
          </p>
        ) : (
          <input
            ref={titleRef}
            className="composer-title"
            value={draft.title}
            placeholder={kind === "note" ? "Title" : "Paste a link, or type a title"}
            aria-label="Title"
            spellCheck={false}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                bodyRef.current?.focus();
              }
            }}
          />
        )}
        <textarea
          ref={bodyRef}
          className="composer-body scrollbar-none"
          value={draft.body}
          placeholder="Start writing…"
          aria-label="Text"
          rows={3}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        />
      </div>

      <div className="composer-chips">
        <DropdownMenu
          label={kindLabel}
          icon={<KindIcon size={14} />}
          items={kindItems}
          align="start"
        />
        <DateChip
          day={draft.day}
          disabled={draft.file !== null}
          onChange={(day) => setDraft(day ? withDay(draft, day) : { ...draft, day: null })}
        />
        {status}
      </div>

      <footer className="composer-footer">
        <button
          type="button"
          className="composer-icon-button composer-icon-button--ring"
          aria-label="Attach a PDF or EPUB"
          title="Attach a PDF or EPUB"
          onClick={() => void attach()}
        >
          <Paperclip size={16} />
        </button>
        {draft.file && (
          <span className="composer-chip">
            <Paperclip size={14} className="composer-chip-icon" aria-hidden />
            <span className="truncate">{getFileName(draft.file)}</span>
            <button
              type="button"
              className="composer-chip-remove"
              aria-label="Remove the file"
              onClick={() => setDraft({ ...draft, file: null, kind: "note", kindPicked: false })}
            >
              <X size={12} />
            </button>
          </span>
        )}
        <Switch
          className="composer-switch ml-auto"
          label="Keep open"
          checked={keepOpen}
          onCheckedChange={setKeepOpen}
        />
        <button type="button" className="composer-submit" disabled={!canSubmit} onClick={submit}>
          {label}
        </button>
      </footer>
    </div>
  );
}

function DateChip({
  day,
  disabled,
  onChange,
}: {
  day: string | null;
  disabled: boolean;
  onChange: (day: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = day ? dayLabel(day, new Date()) : "No date";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="composer-chip"
        disabled={disabled}
        title={disabled ? "A book or paper isn't a day's note" : undefined}
      >
        <CalendarDays size={14} className="composer-chip-icon" aria-hidden />
        <span className={day ? undefined : "text-[var(--text-muted)]"}>{label}</span>
      </PopoverTrigger>
      <PopoverContent className="composer-date">
        <Calendar
          value={day ? parseDay(day) : undefined}
          onChange={(date) => {
            onChange(formatDailyNoteDate(date));
            setOpen(false);
          }}
          weekStartsOn={1}
          showToday
        />
        {day && (
          <PopoverClose className="composer-date-clear" onClick={() => onChange(null)}>
            No date
          </PopoverClose>
        )}
      </PopoverContent>
    </Popover>
  );
}
