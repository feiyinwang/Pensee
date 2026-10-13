import {
  lazy,
  memo,
  startTransition,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { FileText, Plus } from "lucide-react";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { ensureArcTokens } from "@/components/editor-area/board/arc-tokens";
import { EditorScrollContainer } from "@/components/editor-area/editor-scroll-container";
import type { SpaceLocation } from "@/components/editor-area/page-kinds";
import { navigateToFile, openLinkedPage } from "@/hooks/editor-api";
import { openLibraryAdd } from "@/hooks/use-library-add";
import { useSpaceDef, useTypedNotes, type SpaceDef, type TypedNote } from "@/hooks/use-spaces";
import { libraryKindOfTab } from "@/lib/library-add";
import { TONE_COLOR, statusTextTone } from "@/lib/projects";
import { formatRelativeTime } from "@/lib/relative-time";
import { allTypes, notesInTab, type SpaceTab } from "@/lib/spaces";
import { FilesSpace } from "./files-space";
import { NoteGallery } from "./note-gallery";
import { XBookmarksEmpty, XSyncBar } from "./x-sync-bar";
import { noteTitle } from "./space-cover";
import styles from "./spaces.module.css";

// Arc and motion load only when the Projects kanban opens (docs/arc.md).
const ProjectViews = lazy(() => import("./project-views"));

/** A space's page (SPECs/spaces-spec.md): the notes of its types as a
 *  gallery, list or cards, the Projects kanban, or the folder tree for Files. */
export function SpacePage({
  location,
  isActive,
  inColumn,
}: {
  location: SpaceLocation;
  isActive: boolean;
  inColumn: boolean;
}) {
  const isShown = isActive || inColumn;
  const space = useSpaceDef(location);

  return (
    <div
      data-space-page
      className={
        isShown ? "relative z-10 h-full" : "absolute inset-0 invisible pointer-events-none h-full"
      }
      aria-hidden={!isShown}
    >
      <EditorScrollContainer>
        <div
          className={[
            styles.page,
            !inColumn && styles.lone,
            space?.view === "kanban" && styles.fill,
            space?.view === "gallery" && styles.wide,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {space === null ? (
            <Empty
              title="This note isn't a space any more"
              text="Add Type: Space to its properties to bring it back."
            />
          ) : space === undefined ? null : space.view === "files" ? (
            <FilesSpace name={space.name} />
          ) : (
            <TypedSpace key={space.key} space={space} />
          )}
        </div>
      </EditorScrollContainer>
    </div>
  );
}

/** Opens the note; a note with a `Book` file (a Library book) opens with its
 *  book beside it. */
function openNote(event: MouseEvent | KeyboardEvent, path: string, book?: string) {
  const open = event.metaKey || event.ctrlKey ? openLinkedPage : navigateToFile;
  void (async () => {
    await open(path);
    if (!book) return;
    const { openBookBesideOpenPage } = await import("@/lib/book-import");
    await openBookBesideOpenPage(path, book);
  })().catch((error: unknown) => {
    window.alert(`Failed to open: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function TypedSpace({ space }: { space: SpaceDef }) {
  // The tabs are Arc's segmented control; without Arc's tokens its radius and
  // sizes are undefined and the selected tab renders as a square box.
  ensureArcTokens();
  const notes = useTypedNotes(allTypes(space));
  const [tabId, setTabId] = useState(space.tabs[0]?.id ?? "");
  // The selected tab moves at once; the body follows in a render React can
  // interrupt. Once the first tab has painted, the others render offstage in
  // the background, so a switch only swaps which one shows.
  const shownId = useDeferredValue(tabId);
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    if (notes && !warm) startTransition(() => setWarm(true));
  }, [notes, warm]);
  const notesByTab = useMemo(
    () => (notes ? new Map(space.tabs.map((t) => [t.id, notesInTab(notes, t)])) : null),
    [notes, space.tabs],
  );
  const tab = space.tabs.find((t) => t.id === tabId) ?? space.tabs[0];
  if (!tab) return null;
  const shownTab = space.tabs.find((t) => t.id === shownId) ?? tab;
  const addKind = addKindOf(space, tab);

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>{space.name}</h1>
        {notes && <span className={styles.count}>{notes.length}</span>}
        <div className={styles.headerEnd}>
          {space.tabs.length > 1 && (
            <SegmentedControl
              className={styles.typeTabs}
              label={`${space.name} types`}
              value={tab.id}
              onValueChange={setTabId}
              options={space.tabs.map((t) => ({
                value: t.id,
                label: t.label,
                accessory: notesByTab ? (
                  <span className={styles.tabCount}>{notesByTab.get(t.id)?.length ?? 0}</span>
                ) : undefined,
              }))}
            />
          )}
          {addKind && (
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`Add ${tab.noun}`}
              title={`Add ${tab.noun}`}
              onClick={() => openLibraryAdd(addKind)}
            >
              <Plus size={16} strokeWidth={1.75} />
            </button>
          )}
          {space.path && (
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Open the space's note"
              title="Open the space's note"
              onClick={(event) => openNote(event, space.path!)}
            >
              <FileText size={16} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </header>
      {space.tabs
        .filter((t) => warm || t.id === shownTab.id)
        .map((t) => (
          <div key={t.id} className={t.id === shownTab.id ? undefined : styles.offstage}>
            <TabBody space={space} tab={t} shown={notesByTab?.get(t.id) ?? null} />
          </div>
        ))}
    </>
  );
}

/** Library tabs filled by hand add through the palette's add mode, with the
 *  tab's own kind first (SPECs/add-to-library-spec.md); synced tabs don't. */
function addKindOf(space: SpaceDef, tab: SpaceTab) {
  return space.key === "library" && !tab.source ? libraryKindOfTab(tab.id) : null;
}

/** One tab's notes. Memoised: offstage tabs stay mounted and must not
 *  re-render with every switch. */
const TabBody = memo(function TabBody({
  space,
  tab,
  shown,
}: {
  space: SpaceDef;
  tab: SpaceTab;
  shown: TypedNote[] | null;
}) {
  const addKind = addKindOf(space, tab);
  return (
    <>
      {tab.source === "x" && shown !== null && shown.length > 0 && <XSyncBar />}
      {shown === null ? null : shown.length === 0 && tab.source === "x" ? (
        <XBookmarksEmpty />
      ) : shown.length === 0 ? (
        <Empty
          title={`Add your first ${tab.noun}`}
          text={`Any note with Type: ${tab.types[0]} shows up here.`}
          action={
            addKind ? { label: `Add ${tab.noun}`, run: () => openLibraryAdd(addKind) } : undefined
          }
        />
      ) : space.view === "kanban" ? (
        <Suspense fallback={null}>
          <ProjectViews notes={shown} />
        </Suspense>
      ) : space.view === "list" ? (
        <NoteList notes={shown} />
      ) : space.view === "cards" ? (
        <NoteCards notes={shown} />
      ) : (
        <NoteGallery notes={shown} tab={tab} openNote={openNote} />
      )}
    </>
  );
});

function NoteList({ notes }: { notes: TypedNote[] }) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, path: string) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    openNote(event, path);
  };
  return (
    <table className={styles.list}>
      <colgroup>
        <col style={{ width: "60%" }} />
        <col style={{ width: "20%" }} />
        <col style={{ width: "20%" }} />
      </colgroup>
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Last edited</th>
        </tr>
      </thead>
      <tbody>
        {notes.map((note) => {
          const status = note.properties.status;
          return (
            <tr
              key={note.path}
              tabIndex={0}
              onClick={(event) => openNote(event, note.path)}
              onKeyDown={(event) => onKeyDown(event, note.path)}
            >
              <td>{noteTitle(note)}</td>
              <td>
                {status ? (
                  <span
                    className={styles.status}
                    style={
                      { "--tag": TONE_COLOR[statusTextTone(status) ?? "gray"] } as CSSProperties
                    }
                  >
                    {status}
                  </span>
                ) : (
                  <span className={styles.status} data-empty="">
                    No status
                  </span>
                )}
              </td>
              <td>{formatRelativeTime(note.modified_at) ?? ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function NoteCards({ notes }: { notes: TypedNote[] }) {
  return (
    <div className={styles.cards}>
      {notes.map((note) => (
        <button
          key={note.path}
          type="button"
          className={styles.card}
          onClick={(event) => openNote(event, note.path)}
        >
          <span className={styles.cardTitle}>{noteTitle(note)}</span>
          {note.excerpt && <span className={styles.cardText}>{note.excerpt}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: { label: string; run: () => void };
}) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.emptyText}>{text}</div>
      {action && (
        <button type="button" className={styles.emptyAction} onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}
