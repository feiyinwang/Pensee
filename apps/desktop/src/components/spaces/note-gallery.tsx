import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { ImageDown } from "lucide-react";
import { editPage } from "@/components/editor-area/linked-block-sync";
import { showEditorNotice } from "@/components/editor-area/editor-notice-store";
import { coverToGet, withCover } from "@/lib/covers";
import { bylineOf, type CoverKind, type SpaceTab } from "@/lib/spaces";
import * as tauri from "@/lib/tauri";
import type { TypedNote } from "@/lib/tauri";
import { SpaceCover, noteTitle } from "./space-cover";
import styles from "./spaces.module.css";

type OpenNote = (event: MouseEvent | KeyboardEvent, path: string) => void;

/** Download a note's cover into its assets folder and write `Cover:`. */
async function getCover(note: TypedNote, kind: CoverKind): Promise<void> {
  const source = coverToGet(note, kind);
  if (!source) return;
  const cover = await tauri.saveWebCover(source, note.path);
  await editPage(note.path, (page) => ({
    ...page,
    frontmatter: withCover(page.frontmatter, cover),
  }));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A gallery tab: covers in a grid. Notes whose cover can be fetched (a
 *  YouTube link, a podcast page) get a "Get cover" button, and the tab a
 *  "Get covers" line for all of them; nothing is downloaded until clicked. */
export function NoteGallery({
  notes,
  tab,
  openNote,
}: {
  notes: TypedNote[];
  tab: SpaceTab;
  openNote: OpenNote;
}) {
  // "busy" while downloading, "done" until the refetched list carries `Cover:`.
  const [status, setStatus] = useState<ReadonlyMap<string, "busy" | "done">>(new Map());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const mark = (path: string, value: "busy" | "done" | null) =>
    setStatus((prev) => {
      const next = new Map(prev);
      if (value) next.set(path, value);
      else next.delete(path);
      return next;
    });

  const gettable = notes.filter((n) => coverToGet(n, tab.cover) && !status.has(n.path));

  const getOne = async (note: TypedNote): Promise<boolean> => {
    mark(note.path, "busy");
    try {
      await getCover(note, tab.cover);
      mark(note.path, "done");
      return true;
    } catch (error) {
      console.error("[spaces] get cover failed", note.path, error);
      mark(note.path, null);
      throw error;
    }
  };

  const onGetOne = (note: TypedNote) => {
    getOne(note).catch((error: unknown) =>
      showEditorNotice(`Couldn't get the cover for ${noteTitle(note)}: ${errorText(error)}`),
    );
  };

  const onGetAll = async () => {
    const queue = gettable;
    let failed = 0;
    setBulk({ done: 0, total: queue.length });
    // One at a time: each is a request to the same site.
    for (const [i, note] of queue.entries()) {
      if (!(await getOne(note).catch(() => false))) failed += 1;
      setBulk({ done: i + 1, total: queue.length });
    }
    setBulk(null);
    if (failed > 0) {
      showEditorNotice(
        `Got ${queue.length - failed} of ${queue.length} covers. ${failed} couldn't be fetched.`,
      );
    }
  };

  return (
    <>
      {(gettable.length > 0 || bulk) && (
        <div className={styles.coverBar}>
          {bulk ? (
            <span>
              Getting covers… {bulk.done} of {bulk.total}
            </span>
          ) : (
            <>
              <span>
                {gettable.length === 1 ? "1 cover" : `${gettable.length} covers`} not saved in their
                notes yet
              </span>
              <button
                type="button"
                className={styles.coverBarButton}
                title="Download each cover into its note's assets folder and set Cover:"
                onClick={onGetAll}
              >
                Get covers
              </button>
            </>
          )}
        </div>
      )}
      <div className={styles.gallery} data-cover={tab.cover}>
        {notes.map((note) => {
          const state = status.get(note.path);
          const canGet = state !== "done" && coverToGet(note, tab.cover) !== null;
          return (
            <div key={note.path} className={styles.itemWrap}>
              <button
                type="button"
                className={styles.item}
                onClick={(event) => openNote(event, note.path)}
              >
                <SpaceCover note={note} kind={tab.cover} />
                <span className={styles.itemTitle}>{noteTitle(note)}</span>
                <span className={styles.itemSub}>{bylineOf(note) ?? ""}</span>
              </button>
              {canGet && (
                <button
                  type="button"
                  className={styles.getCover}
                  data-busy={state === "busy" ? "" : undefined}
                  disabled={state === "busy" || bulk !== null}
                  aria-label={state === "busy" ? "Getting cover" : "Get cover"}
                  title={state === "busy" ? "Getting cover…" : "Get cover: save it into the note"}
                  onClick={() => onGetOne(note)}
                >
                  <ImageDown size={14} strokeWidth={1.75} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
