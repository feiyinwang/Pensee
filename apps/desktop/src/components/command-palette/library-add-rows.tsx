import { CommandGroup, CommandItem } from "cmdk";
import { BookOpen, Clapperboard, FileText, Mic, type LucideIcon } from "lucide-react";
import {
  LIBRARY_KINDS,
  LIBRARY_KIND_LABELS,
  findLibraryNote,
  parseLibraryLink,
  type LibraryKind,
} from "@/lib/library-add";
import type { TypedNote } from "@/lib/tauri";

// The palette's "Add to Library" rows (SPECs/add-to-library-spec.md): in ⌘F
// when the query is a link. Titles and files are added from the composer.
// Rows are worked out from the query alone, with no network, so they never
// change under the cursor.

const KIND_ICONS: Record<LibraryKind, LucideIcon> = {
  book: BookOpen,
  video: Clapperboard,
  podcast: Mic,
  paper: FileText,
};

export interface LibraryRow {
  value: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  run: () => void;
}

export interface LibraryGroup {
  heading: string;
  rows: LibraryRow[];
}

export interface LibraryActions {
  addLink: (link: NonNullable<ReturnType<typeof parseLibraryLink>>, kind: LibraryKind) => void;
  openNote: (path: string) => void;
}

/** `first`, then the other kinds in Library's tab order. */
function kindsFrom(first: LibraryKind | null): LibraryKind[] {
  return first ? [first, ...LIBRARY_KINDS.filter((k) => k !== first)] : [...LIBRARY_KINDS];
}

function kindOfType(noteType: string): LibraryKind {
  const kind = /^(youtube|video)$/i.test(noteType) ? "video" : noteType.toLowerCase();
  return (LIBRARY_KINDS as readonly string[]).includes(kind) ? (kind as LibraryKind) : "book";
}

/**
 * The groups to show: rows only for a query that is one link. `notes` are
 * the Library notes, or null while they load (a link is then offered as new).
 */
export function libraryGroups({
  query,
  notes,
  actions,
}: {
  query: string;
  notes: readonly TypedNote[] | null;
  actions: LibraryActions;
}): LibraryGroup[] {
  const link = parseLibraryLink(query);
  if (!link) return [];
  const existing = notes ? findLibraryNote(notes, link.url) : null;
  if (existing) {
    return [
      {
        heading: "Already in your Library",
        rows: [
          {
            value: `library:open:${existing.path}`,
            label: existing.title ?? existing.name,
            description: `${LIBRARY_KIND_LABELS[kindOfType(existing.note_type)]} · ${existing.relative_path}`,
            icon: KIND_ICONS[kindOfType(existing.note_type)],
            run: () => actions.openNote(existing.path),
          },
        ],
      },
    ];
  }
  return [
    {
      heading: "Add to Library",
      rows: kindsFrom(link.guess).map((kind, index) => ({
        value: `library:link:${kind}`,
        label: `${LIBRARY_KIND_LABELS[kind]}: ${link.host}`,
        description: index === 0 && link.guess === kind ? "Guessed from the link" : undefined,
        icon: KIND_ICONS[kind],
        run: () => actions.addLink(link, kind),
      })),
    },
  ];
}

export function LibraryGroups({ groups }: { groups: LibraryGroup[] }) {
  return groups.map((group) => (
    <CommandGroup key={group.heading} heading={group.heading}>
      {group.rows.map((row) => (
        <CommandItem key={row.value} value={row.value} onSelect={row.run}>
          <div className="flex min-w-0 items-center gap-2">
            <row.icon size={14} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden />
            <div className="flex min-w-0 flex-col">
              <span className="truncate">{row.label}</span>
              {row.description && (
                <span className="truncate text-caption text-[var(--color-text-muted)]">
                  {row.description}
                </span>
              )}
            </div>
          </div>
        </CommandItem>
      ))}
    </CommandGroup>
  ));
}
