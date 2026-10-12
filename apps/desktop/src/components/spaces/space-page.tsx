import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { FileText } from "lucide-react";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { EditorScrollContainer } from "@/components/editor-area/editor-scroll-container";
import type { SpaceLocation } from "@/components/editor-area/page-kinds";
import { navigateToFile, openLinkedPage } from "@/hooks/editor-api";
import { useSpaceDef, useTypedNotes, type SpaceDef, type TypedNote } from "@/hooks/use-spaces";
import { formatRelativeTime } from "@/lib/relative-time";
import { allTypes, bylineOf, notesInTab, type SpaceTab } from "@/lib/spaces";
import { FilesSpace } from "./files-space";
import { SpaceCover, noteTitle } from "./space-cover";
import styles from "./spaces.module.css";

/** A space's page (SPECs/spaces-spec.md): the notes of its types as a
 *  gallery, list or cards, or the folder tree for Files. */
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
        <div className={styles.page}>
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

function openNote(event: MouseEvent | KeyboardEvent, path: string) {
  const open = event.metaKey || event.ctrlKey ? openLinkedPage : navigateToFile;
  void open(path).catch((error: unknown) => {
    window.alert(`Failed to open: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function TypedSpace({ space }: { space: SpaceDef }) {
  const notes = useTypedNotes(allTypes(space));
  const [tabId, setTabId] = useState(space.tabs[0]?.id ?? "");
  const tab = space.tabs.find((t) => t.id === tabId) ?? space.tabs[0];
  if (!tab) return null;
  const shown = notes ? notesInTab(notes, tab) : null;

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>{space.name}</h1>
        {notes && <span className={styles.count}>{notes.length}</span>}
        <div className={styles.headerEnd}>
          {space.tabs.length > 1 && (
            <SegmentedControl
              label={`${space.name} types`}
              value={tab.id}
              onValueChange={setTabId}
              options={space.tabs.map((t) => ({
                value: t.id,
                label: t.label,
                accessory: notes ? (
                  <span className={styles.tabCount}>{notesInTab(notes, t).length}</span>
                ) : undefined,
              }))}
            />
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
      {shown === null ? null : shown.length === 0 ? (
        <Empty
          title={`Add your first ${tab.noun}`}
          text={`Any note with Type: ${tab.types[0]} shows up here.`}
        />
      ) : space.view === "list" ? (
        <NoteList notes={shown} />
      ) : space.view === "cards" ? (
        <NoteCards notes={shown} />
      ) : (
        <NoteGallery notes={shown} tab={tab} />
      )}
    </>
  );
}

function NoteGallery({ notes, tab }: { notes: TypedNote[]; tab: SpaceTab }) {
  return (
    <div className={styles.gallery} data-cover={tab.cover}>
      {notes.map((note) => (
        <button
          key={note.path}
          type="button"
          className={styles.item}
          onClick={(event) => openNote(event, note.path)}
        >
          <SpaceCover note={note} kind={tab.cover} />
          <span className={styles.itemTitle}>{noteTitle(note)}</span>
          <span className={styles.itemSub}>{bylineOf(note) ?? ""}</span>
        </button>
      ))}
    </div>
  );
}

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
                  <span className={styles.status}>{status}</span>
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

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.emptyText}>{text}</div>
    </div>
  );
}
