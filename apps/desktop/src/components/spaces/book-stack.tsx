import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { bookLength, bookThickness } from "@/lib/books";
import { bylineOf } from "@/lib/spaces";
import type { TypedNote } from "@/lib/tauri";
import { coverSrc, noteTitle, toneClass } from "./space-cover";
import spaces from "./spaces.module.css";
import styles from "./book-stack.module.css";

type OpenNote = (event: MouseEvent | KeyboardEvent, path: string) => void;

/** The Books tab (SPECs/book-stack-spec.md): hardcovers lying flat, one under
 *  another, spine toward you, with the top board seen from just above. */
export function BookStack({ notes, openNote }: { notes: TypedNote[]; openNote: OpenNote }) {
  return (
    <div className={styles.stack}>
      {notes.map((note) => (
        <StackedBook key={note.path} note={note} openNote={openNote} />
      ))}
    </div>
  );
}

function StackedBook({ note, openNote }: { note: TypedNote; openNote: OpenNote }) {
  const title = noteTitle(note);
  const src = coverSrc(note);
  const [failed, setFailed] = useState<string | null>(null);
  const image = src !== null && failed !== src ? src : null;
  const byline = bylineOf(note);
  const publisher = note.properties.publisher ?? null;
  const shape = {
    "--book-length": `${bookLength(title)}px`,
    "--book-thickness": `${bookThickness(note, title)}px`,
  } as CSSProperties;

  return (
    <button
      type="button"
      className={`${styles.book} ${toneClass(title)}`}
      data-image={image ? "" : undefined}
      style={shape}
      title={title}
      onClick={(event) => openNote(event, note.path)}
    >
      <span className={styles.box}>
        <span className={styles.board}>
          {image && (
            <img
              className={styles.boardImage}
              src={image}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setFailed(image)}
            />
          )}
        </span>
        <span className={styles.spine}>
          {image && (
            <img
              className={styles.spineImage}
              src={image}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          )}
          <span className={`${styles.author} ${spaces.serif}`}>{byline ?? ""}</span>
          <span className={`${styles.title} ${spaces.serif}`}>{title}</span>
          <span className={styles.publisher}>{publisher ?? ""}</span>
        </span>
      </span>
    </button>
  );
}
