import { create } from "zustand";
import { getPreference, setPreference } from "@/lib/preferences";
import { fetchChangelog, latestRelease, upgradeApp } from "@/lib/tauri";
import {
  isNewerVersion,
  isUnseenRelease,
  parseChangelog,
  unseenDay,
  type ChangelogDay,
} from "@/lib/whats-new";

/** Where an Update click is. It outlives the card, so closing the card while
 *  it downloads and opening it again from ⌘P shows how it went. */
export type UpgradeState =
  | { step: "idle" }
  | { step: "running" }
  | { step: "done" }
  | { step: "failed"; error: string };

interface WhatsNewState {
  /** The day the card shows, or null when it's closed (SPECs/whats-new-card-spec.md). */
  day: ChangelogDay | null;
  /** A release newer than the running app, which the card offers to update to. */
  release: string | null;
  upgrade: UpgradeState;
}

export const useWhatsNewStore = create<WhatsNewState>(() => ({
  day: null,
  release: null,
  upgrade: { step: "idle" },
}));

const SEEN_KEY = "whatsNew.lastSeen";
const RELEASE_SEEN_KEY = "whatsNew.releaseSeen";

/** How often an open Pensée reads the changelog again. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let checking = false;

/** The latest release when it's newer than this app. A failed check is
 *  logged and counts as no release: the changelog card doesn't wait on it. */
async function newerRelease(): Promise<string | null> {
  try {
    const { version, current } = await latestRelease();
    return isNewerVersion(version, current) ? version : null;
  } catch (error) {
    console.warn("[whats-new] Couldn't read the latest release:", error);
    return null;
  }
}

/** Reads the changelog and the latest release, and shows the card when there's
 *  a day or a release the writer hasn't seen. A failed read is logged and left
 *  for the next check: nothing waits on it. */
export async function checkWhatsNew(): Promise<void> {
  if (checking || useWhatsNewStore.getState().day) return;
  checking = true;
  try {
    const [markdown, release] = await Promise.all([fetchChangelog(), newerRelease()]);
    const days = parseChangelog(markdown);
    const result = unseenDay(days, await getPreference<string | null>(SEEN_KEY, null));
    if (result && "record" in result) await setPreference(SEEN_KEY, result.record);
    const releaseSeen = await getPreference<string | null>(RELEASE_SEEN_KEY, null);
    const freshRelease = release !== null && isUnseenRelease(release, releaseSeen);
    const day = result && "show" in result ? result.show : freshRelease ? days[0] : null;
    if (day) useWhatsNewStore.setState({ day, release });
  } catch (error) {
    console.warn("[whats-new] Couldn't read the changelog:", error);
  } finally {
    checking = false;
  }
}

/** ⌘P → Show What's New: the newest day, seen or not, with an Update when a
 *  newer release is out. */
export async function showWhatsNew(): Promise<void> {
  const [markdown, release] = await Promise.all([fetchChangelog(), newerRelease()]);
  const [newest] = parseChangelog(markdown);
  if (!newest) throw new Error("The changelog has no dated section.");
  useWhatsNewStore.setState({ day: newest, release });
}

/** Closes the card and remembers its day and release, so it shows again only
 *  for a newer one. */
export async function dismissWhatsNew(): Promise<void> {
  const { day, release } = useWhatsNewStore.getState();
  useWhatsNewStore.setState({ day: null });
  if (day) {
    const seen = await getPreference<string | null>(SEEN_KEY, null);
    if (seen === null || day.date > seen) await setPreference(SEEN_KEY, day.date);
  }
  if (release) {
    const seen = await getPreference<string | null>(RELEASE_SEEN_KEY, null);
    if (isUnseenRelease(release, seen)) await setPreference(RELEASE_SEEN_KEY, release);
  }
}

/** Update: upgrades Pensée the way it was installed. The card shows its
 *  progress, then Restart Pensée, or the error when it fails. */
export async function startUpgrade(): Promise<void> {
  if (useWhatsNewStore.getState().upgrade.step === "running") return;
  useWhatsNewStore.setState({ upgrade: { step: "running" } });
  try {
    await upgradeApp();
    useWhatsNewStore.setState({ upgrade: { step: "done" } });
  } catch (error) {
    console.error("[whats-new] The update failed:", error);
    useWhatsNewStore.setState({ upgrade: { step: "failed", error: String(error) } });
  }
}
