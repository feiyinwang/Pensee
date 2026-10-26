import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Mic, Play } from "lucide-react";
import { getParentDir, isAbsolutePath } from "@/lib/paths";
import { liveCoverSrc } from "@/lib/covers";
import { TONES, bylineOf, titleHash, type CoverKind } from "@/lib/spaces";
import type { TypedNote } from "@/lib/tauri";
import styles from "./spaces.module.css";

/** The box, in device pixels, a gallery cover of each kind is drawn in at
 *  its widest (about one and a half times the grid's minimum column, at 2x),
 *  so a local cover is decoded at that size, not its own. */
const THUMB_BOX: Record<CoverKind, readonly [number, number]> = {
  book: [360, 540],
  paper: [400, 533],
  podcast: [400, 400],
  video: [640, 360],
  note: [400, 400],
};

/** A frontmatter value (optionally in `[[ ]]`) as a web address, or a vault
 *  path resolved from the note's folder. */
function noteFile(notePath: string, raw: string | undefined): string | null {
  const value = raw
    ?.trim()
    .replace(/^!?\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    ?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return isAbsolutePath(value) ? value : `${getParentDir(notePath)}/${value}`;
}

/** `path` scaled down to `kind`'s box by the `thumb` protocol
 *  (src-tauri/src/thumbs.rs). */
function thumbSrc(path: string, kind: CoverKind): string {
  const [w, h] = THUMB_BOX[kind];
  return `${convertFileSrc(path, "thumb")}?w=${w}&h=${h}`;
}

/** `Cover:` as an image URL: a web address as is, a vault path as a thumbnail. */
export function coverSrc(note: TypedNote, kind: CoverKind): string | null {
  return coverValueSrc(note.path, note.properties.cover, kind);
}

/** A `Cover:` value of the note at `notePath` as an image URL. */
export function coverValueSrc(
  notePath: string,
  value: string | undefined,
  kind: CoverKind,
): string | null {
  const file = noteFile(notePath, value);
  if (!file) return null;
  return /^https?:\/\//i.test(file) ? file : thumbSrc(file, kind);
}

/** The cover inside the note's `Book:` EPUB (what Apple Books shows), read
 *  out of the zip by the `thumb` protocol. A PDF's first page would need a
 *  renderer there, so a PDF book keeps its `Cover:`. */
function bookFileSrc(note: TypedNote, kind: CoverKind): string | null {
  const file = noteFile(note.path, note.properties.book);
  if (!file || !/\.epub$/i.test(file) || /^https?:\/\//i.test(file)) return null;
  return thumbSrc(file, kind);
}

export function noteTitle(note: TypedNote): string {
  return note.title ?? note.name;
}

/** "NeurIPS · 2017" from whichever of venue/journal/year a paper carries. */
function venueOf(note: TypedNote): string | null {
  const p = note.properties;
  const venue = p.venue ?? p.journal ?? p.conference ?? p.publisher ?? null;
  const year = p.year ?? p.published?.slice(0, 4) ?? null;
  const parts = [venue, year].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** A note's cover, the first that loads of: the cover inside its `Book:`
 *  EPUB, its own `Cover:` image, a video's YouTube thumbnail from its link;
 *  else the default cover for its kind, coloured and laid out by a hash of
 *  its title. The book's own cover comes first because a saved `Cover:` can
 *  be stale or blank (an Apple Books export can save one solid black). */
export function SpaceCover({ note, kind }: { note: TypedNote; kind: CoverKind }) {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const src =
    [bookFileSrc(note, kind), coverSrc(note, kind), liveCoverSrc(note, kind)].find(
      (s): s is string => s !== null && !failed.includes(s),
    ) ?? null;
  const title = noteTitle(note);
  const hash = titleHash(title);
  const tone = styles[`tone${hash % TONES}`];

  return (
    <div className={`${styles.cover} ${tone}`} data-kind={kind}>
      {src ? (
        <img
          className={styles.coverImage}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed((list) => [...list, src])}
        />
      ) : (
        <DefaultCover note={note} kind={kind} title={title} layout={(hash >>> 4) % 3} />
      )}
    </div>
  );
}

function DefaultCover({
  note,
  kind,
  title,
  layout,
}: {
  note: TypedNote;
  kind: CoverKind;
  title: string;
  layout: number;
}) {
  const byline = bylineOf(note);
  switch (kind) {
    case "book":
      if (layout === 1) {
        return (
          <div className={styles.bookCentered}>
            <div className={styles.bookRule} />
            <div className={`${styles.bookTop} ${styles.serif}`}>{title}</div>
            {byline && <div className={styles.bookByline}>{byline}</div>}
            <div className={styles.bookRule} />
          </div>
        );
      }
      if (layout === 2) {
        return (
          <>
            <div className={`${styles.bookInitial} ${styles.serif}`}>
              {Array.from(title)[0] ?? ""}
            </div>
            <div className={styles.bookInitialTitle}>
              {title}
              {byline && <span>{byline}</span>}
            </div>
          </>
        );
      }
      return (
        <>
          <div className={`${styles.bookTop} ${styles.serif}`}>{title}</div>
          {byline && <div className={styles.bookByline}>{byline}</div>}
        </>
      );
    case "video":
      return (
        <>
          <div className={styles.videoTitle}>{title}</div>
          <div className={styles.videoPlay}>
            <Play size={13} fill="currentColor" strokeWidth={0} />
          </div>
        </>
      );
    case "podcast":
      return (
        <>
          <div className={styles.podcastMark}>
            <Mic size={18} strokeWidth={1.75} />
          </div>
          <div className={styles.podcastTitle}>{title}</div>
        </>
      );
    case "paper": {
      const venue = venueOf(note);
      return (
        <>
          {venue && <div className={styles.paperVenue}>{venue}</div>}
          <div className={`${styles.paperTitle} ${styles.serif}`}>{title}</div>
          {byline && <div className={styles.paperAuthors}>{byline}</div>}
          <div className={styles.paperLines}>
            {[100, 94, 97, 62].map((w) => (
              <span key={w} style={{ width: `${w}%` }} />
            ))}
          </div>
          <div className={styles.paperLines}>
            {[100, 91, 96, 98, 44].map((w) => (
              <span key={w} style={{ width: `${w}%` }} />
            ))}
          </div>
        </>
      );
    }
    case "note":
      return <div className={`${styles.bookTop} ${styles.serif}`}>{title}</div>;
  }
}
