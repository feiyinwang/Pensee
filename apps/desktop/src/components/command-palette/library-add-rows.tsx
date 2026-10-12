import { CommandGroup, CommandItem } from "cmdk";
import {
  BookOpen,
  Clapperboard,
  FileText,
  FileUp,
  GraduationCap,
  Library,
  Mic,
  type LucideIcon,
} from "lucide-react";
import {
  LIBRARY_KINDS,
  LIBRARY_KIND_LABELS,
  findLibraryNote,
  parseLibraryLink,
  type LibraryKind,
} from "@/lib/library-add";
import type { TypedNote } from "@/lib/tauri";
import { safePageName } from "@/lib/wiki-pages";

// The palette's "Add to Library" rows (SPECs/add-to-library-spec.md): in ⌘O
// when the query is a link, and in add mode for links, titles and files.
// Rows are worked out from the query alone, with no network, so they never
// change under the cursor.

const KIND_ICONS: Record<LibraryKind, LucideIcon> = {
  book: BookOpen,
  video: Clapperboard,
  podcast: Mic,
  course: GraduationCap,
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
  addTitle: (title: string, kind: LibraryKind) => void;
  openNote: (path: string) => void;
  chooseFile: () => void;
  importAppleBooks: () => void;
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
 * The groups to show. `addMode` is the palette's add mode; otherwise (⌘O)
 * only a query that is one link gets rows. `notes` are the Library notes, or
 * null while they load (a link is then offered as new).
 */
export function libraryGroups({
  query,
  addMode,
  preferKind,
  notes,
  actions,
}: {
  query: string;
  addMode: boolean;
  preferKind: LibraryKind | null;
  notes: readonly TypedNote[] | null;
  actions: LibraryActions;
}): LibraryGroup[] {
  const link = parseLibraryLink(query);
  if (link) {
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
    const first = preferKind ?? link.guess;
    return [
      {
        heading: "Add to Library",
        rows: kindsFrom(first).map((kind, index) => ({
          value: `library:link:${kind}`,
          label: `${LIBRARY_KIND_LABELS[kind]}: ${link.host}`,
          description:
            index === 0 && !preferKind && link.guess === kind ? "Guessed from the link" : undefined,
          icon: KIND_ICONS[kind],
          run: () => actions.addLink(link, kind),
        })),
      },
    ];
  }
  if (!addMode) return [];

  const title = safePageName(query);
  if (!title) {
    return [
      {
        heading: "Add to Library",
        rows: [
          {
            value: "library:choose-file",
            label: "Choose a PDF or EPUB…",
            icon: FileUp,
            run: actions.chooseFile,
          },
          {
            value: "library:apple-books",
            label: "Import Apple Books Highlights",
            icon: Library,
            run: actions.importAppleBooks,
          },
        ],
      },
    ];
  }
  return [
    {
      heading: "Add to Library",
      rows: kindsFrom(preferKind ?? "book").map((kind, index) => ({
        value: `library:title:${kind}`,
        label: `${LIBRARY_KIND_LABELS[kind]}: ${title}`,
        description: index === 0 ? "Title only" : undefined,
        icon: KIND_ICONS[kind],
        run: () => actions.addTitle(title, kind),
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
            <row.icon size={14} className="shrink-0 text-text-muted" aria-hidden />
            <div className="flex min-w-0 flex-col">
              <span className="truncate">{row.label}</span>
              {row.description && (
                <span className="truncate text-[13px] text-text-muted">{row.description}</span>
              )}
            </div>
          </div>
        </CommandItem>
      ))}
    </CommandGroup>
  ));
}
