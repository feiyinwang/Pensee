import { pageProperty } from "./book-highlights";
import { LINK_KEYS, webAddressIn, youtubeVideoId } from "./covers";
import { parseLibraryLink } from "./library-add";

// Podcast notes (SPECs/podcast-notes-spec.md): which notes play an episode,
// and the speeds the player steps through. Pure; the player lives in
// `components/editor-area/podcast-player.tsx`.

const AUDIO_FILE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i;

/**
 * The episode link a note plays, or null: a link under `url`, `link` or
 * `source` in a note whose `Type` is `Podcast`, or one that is a podcast
 * app's episode or an audio file in any note. A YouTube link is the video
 * player's.
 */
export function podcastLinkOf(frontmatter: string | null): string | null {
  if (!frontmatter) return null;
  const isPodcast = pageProperty(frontmatter, "type")?.toLowerCase() === "podcast";
  for (const key of LINK_KEYS) {
    const address = webAddressIn(pageProperty(frontmatter, key) ?? undefined);
    if (!address || youtubeVideoId(address)) continue;
    if (isPodcast || parseLibraryLink(address)?.guess === "podcast") return address;
    try {
      if (AUDIO_FILE.test(new URL(address).pathname)) return address;
    } catch {
      // Not a URL after all; the next key may hold one.
    }
  }
  return null;
}

/** What `<` and `>` step through. */
export const PODCAST_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
/** What a click on the speed cycles through, back to 1× after the last. */
export const PODCAST_SPEED_PRESETS = [1, 1.25, 1.5, 1.75, 2] as const;

/** One step slower (-1) or faster (1) from `rate`, held at the ends. */
export function stepPodcastSpeed(rate: number, step: -1 | 1): number {
  if (step === 1)
    return (
      PODCAST_SPEEDS.find((s) => s > rate + 0.001) ?? PODCAST_SPEEDS[PODCAST_SPEEDS.length - 1]!
    );
  return [...PODCAST_SPEEDS].reverse().find((s) => s < rate - 0.001) ?? PODCAST_SPEEDS[0];
}

/** The next preset after `rate`, wrapping to 1×. */
export function nextPodcastPreset(rate: number): number {
  return PODCAST_SPEED_PRESETS.find((s) => s > rate + 0.001) ?? 1;
}

/** `1×`, `1.25×`. */
export function formatSpeed(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}
