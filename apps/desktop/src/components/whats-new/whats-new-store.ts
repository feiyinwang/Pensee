import { create } from "zustand";
import { getPreference, setPreference } from "@/lib/preferences";
import { fetchChangelog } from "@/lib/tauri";
import { parseChangelog, unseenDay, type ChangelogDay } from "@/lib/whats-new";

/** The day the card shows, or null when it's closed (SPECs/whats-new-card-spec.md). */
export const useWhatsNewStore = create<{ day: ChangelogDay | null }>(() => ({ day: null }));

const SEEN_KEY = "whatsNew.lastSeen";

/** How often an open Pensée reads the changelog again. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let checking = false;

/** Reads the changelog and shows its newest day if the writer hasn't seen it.
 *  A failed read is logged and left for the next check: nothing waits on it. */
export async function checkWhatsNew(): Promise<void> {
  if (checking || useWhatsNewStore.getState().day) return;
  checking = true;
  try {
    const days = parseChangelog(await fetchChangelog());
    const result = unseenDay(days, await getPreference<string | null>(SEEN_KEY, null));
    if (result && "record" in result) await setPreference(SEEN_KEY, result.record);
    else if (result) useWhatsNewStore.setState({ day: result.show });
  } catch (error) {
    console.warn("[whats-new] Couldn't read the changelog:", error);
  } finally {
    checking = false;
  }
}

/** ⌘P → Show What's New: the newest day, seen or not. */
export async function showWhatsNew(): Promise<void> {
  const [newest] = parseChangelog(await fetchChangelog());
  if (!newest) throw new Error("The changelog has no dated section.");
  useWhatsNewStore.setState({ day: newest });
}

/** Closes the card and remembers its day, so it shows again only for a newer one. */
export async function dismissWhatsNew(): Promise<void> {
  const day = useWhatsNewStore.getState().day;
  useWhatsNewStore.setState({ day: null });
  if (!day) return;
  const seen = await getPreference<string | null>(SEEN_KEY, null);
  if (seen === null || day.date > seen) await setPreference(SEEN_KEY, day.date);
}
