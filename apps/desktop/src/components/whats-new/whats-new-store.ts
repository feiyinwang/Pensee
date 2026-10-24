import { create } from "zustand";
import { getPreference, setPreference } from "@/lib/preferences";
import { readChangelog } from "@/lib/tauri";
import { parseChangelog, unseenDays, type ChangelogDay } from "@/lib/whats-new";

/** The days the card shows, newest first, or null when it's closed
 *  (SPECs/whats-new-card-spec.md). */
export const useWhatsNewStore = create<{ days: ChangelogDay[] | null }>(() => ({ days: null }));

const SEEN_KEY = "whatsNew.lastSeen";

let checking = false;

/** Reads the changelog this build was made with and shows the days the
 *  writer hasn't seen. A failed read is logged: nothing waits on it. */
export async function checkWhatsNew(): Promise<void> {
  if (checking || useWhatsNewStore.getState().days) return;
  checking = true;
  try {
    const days = parseChangelog(await readChangelog());
    const result = unseenDays(days, await getPreference<string | null>(SEEN_KEY, null));
    if (result && "record" in result) await setPreference(SEEN_KEY, result.record);
    else if (result) useWhatsNewStore.setState({ days: result.show });
  } catch (error) {
    console.warn("[whats-new] Couldn't read the changelog:", error);
  } finally {
    checking = false;
  }
}

/** ⌘P → Show What's New: the newest day, seen or not. */
export async function showWhatsNew(): Promise<void> {
  const [newest] = parseChangelog(await readChangelog());
  if (!newest) throw new Error("The changelog has no dated section.");
  useWhatsNewStore.setState({ days: [newest] });
}

/** Closes the card and remembers its newest day, so it shows again only for a newer one. */
export async function dismissWhatsNew(): Promise<void> {
  const days = useWhatsNewStore.getState().days;
  useWhatsNewStore.setState({ days: null });
  if (!days) return;
  const newest = days[0].date;
  const seen = await getPreference<string | null>(SEEN_KEY, null);
  if (seen === null || newest > seen) await setPreference(SEEN_KEY, newest);
}
