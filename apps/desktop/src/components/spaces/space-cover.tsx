import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Mic, Play } from "lucide-react";
import { getParentDir } from "@/lib/paths";
import { liveCoverSrc } from "@/lib/covers";
import { bylineOf, titleHash, type CoverKind } from "@/lib/spaces";
import type { TypedNote } from "@/lib/tauri";
import styles from "./spaces.module.css";

const TONES = 10;

/** The box, in device pixels, a gallery cover of each kind is drawn in at
 *  its widest (about one and a half times the grid's minimum column, at 2x),
 *  so a local cover is decoded at that size, not its own. */
const THUMB_BOX: Record<CoverKind, readonly [number, number]> = {
  book: [360, 540],
  paper: [400, 533],
  podcast: [400, 400],
  course: [560, 420],
  video: [640, 360],
  tweet: [600, 375],
  note: [400, 400],
};

/** `Cover:` as an image URL: a web address as is, a vault path (optionally in
 *  `[[ ]]`) from the note's folder scaled down to `kind`'s box by the `thumb`
 *  protocol (src-tauri/src/thumbs.rs). */
export function coverSrc(note: TypedNote, kind: CoverKind): string | null {
  const raw = note.properties.cover?.trim();
  if (!raw) return null;
  const value = raw
    .replace(/^!?\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const absolute = value.startsWith("/") ? value : `${getParentDir(note.path)}/${value}`;
  const [w, h] = THUMB_BOX[kind];
  return `${convertFileSrc(absolute, "thumb")}?w=${w}&h=${h}`;
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

/** A note's cover: its own `Cover:` image when it loads, else a video's
 *  YouTube thumbnail from its link, else the default cover for its kind,
 *  coloured and laid out by a hash of its title. */
export function SpaceCover({ note, kind }: { note: TypedNote; kind: CoverKind }) {
  const src = coverSrc(note, kind) ?? liveCoverSrc(note, kind);
  const [failed, setFailed] = useState<string | null>(null);
  const title = noteTitle(note);
  const hash = titleHash(title);
  const tone = styles[`tone${hash % TONES}`];
  const showImage = src !== null && failed !== src;

  return (
    <div className={`${styles.cover} ${tone}`} data-kind={kind}>
      {showImage ? (
        <img
          className={styles.coverImage}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(src)}
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
    case "course":
      return (
        <>
          <div className={styles.eyebrow}>Course</div>
          <div className={styles.courseTitle}>{title}</div>
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
    case "tweet":
      return <div className={`${styles.bookTop} ${styles.serif}`}>{title}</div>;
  }
}
