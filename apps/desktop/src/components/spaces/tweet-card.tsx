import { useState } from "react";
import { Play } from "lucide-react";
import { tweetAvatar } from "@/lib/spaces";
import type { TypedNote } from "@/lib/tauri";
import { coverSrc } from "./space-cover";
import styles from "./spaces.module.css";

// A bookmark from X in Library (SPECs/x-bookmarks-spec.md): the card is the
// post itself, its first paragraph and the thread's first picture, with the
// author and thread length under it like every other gallery item.

/** A post this short is set large, like a quote, instead of leaving most of
 *  its card empty. */
const SHORT_POST_CHARS = 140;

function durationLabel(seconds: string | undefined): string | null {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return null;
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** What the picture is, when that isn't obvious from looking at it. */
function MediaBadge({ note }: { note: TypedNote }) {
  const { media, duration, photos } = note.properties;
  if (media === "video") {
    return (
      <span className={styles.tweetBadge}>
        <Play size={8} fill="currentColor" strokeWidth={0} />
        {durationLabel(duration) ?? "Video"}
      </span>
    );
  }
  if (media === "gif") return <span className={styles.tweetBadge}>GIF</span>;
  if (media === "photos" && Number(photos) > 1) {
    return <span className={styles.tweetBadge}>{photos} photos</span>;
  }
  return null;
}

export function TweetCover({ note }: { note: TypedNote }) {
  const src = coverSrc(note, "tweet");
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = src !== null && failed !== src;
  return (
    <div
      className={styles.cover}
      data-kind="tweet"
      data-media={showImage ? "" : undefined}
      data-short={!showImage && (note.excerpt?.length ?? 0) <= SHORT_POST_CHARS ? "" : undefined}
    >
      {note.excerpt && <p className={styles.tweetText}>{note.excerpt}</p>}
      {showImage && (
        <div className={styles.tweetMedia}>
          <img
            className={styles.coverImage}
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(src)}
          />
          <MediaBadge note={note} />
        </div>
      )}
    </div>
  );
}

/** Author with an initial for an avatar, then `@handle · Thread · 7 posts`. */
export function TweetCaption({ note }: { note: TypedNote }) {
  const { author, handle, posts } = note.properties;
  const avatar = tweetAvatar(author, handle, note.name);
  const count = Number(posts);
  const kind = count > 1 ? `Thread · ${count} posts` : "Post";
  const tone = styles[`tone${avatar.tone}`];
  return (
    <>
      <span className={styles.tweetByline}>
        <span className={`${styles.tweetAvatar} ${tone}`} aria-hidden="true">
          {avatar.initial}
        </span>
        <span className={styles.tweetAuthor}>{avatar.name}</span>
      </span>
      <span className={`${styles.itemSub} ${styles.tweetSub}`}>
        {handle ? `@${handle} · ${kind}` : kind}
      </span>
    </>
  );
}
