import { create } from "zustand";
import { getPreference, setPreference } from "@/lib/preferences";

/** The four screens (SPECs/onboarding-spec.md), plus the practice loop that
 *  runs in the real app between the third and the last. */
export type OnboardingScreen = "notes" | "ai" | "try" | "practice" | "more";

export type SampleId = "video" | "podcast" | "book" | "write";

interface OnboardingState {
  open: boolean;
  screen: OnboardingScreen;
  sample: SampleId | null;
  /** The practice note the guide watches. */
  practicePath: string | null;
}

export const useOnboardingStore = create<OnboardingState>(() => ({
  open: false,
  screen: "notes",
  sample: null,
  practicePath: null,
}));

const DONE_KEY = "onboarding.done";
const STARTED_KEY = "onboarding.started";

/** First run: no folder open and onboarding never finished. A run that was
 *  quit midway picks up on the AI screen, since its folder is open by then. */
export async function maybeStartOnboarding(root: string | null): Promise<void> {
  if (await getPreference(DONE_KEY, false)) return;
  if (root === null) {
    showOnboarding("notes");
  } else if (await getPreference(STARTED_KEY, false)) {
    showOnboarding("ai");
  }
}

/** Opens onboarding at `screen` (the palette's "Show onboarding" starts at AI). */
export function showOnboarding(screen: OnboardingScreen = "notes"): void {
  useOnboardingStore.setState({ open: true, screen, sample: null, practicePath: null });
}

export function goToScreen(screen: OnboardingScreen): void {
  useOnboardingStore.setState({ screen });
  if (screen !== "notes") void setPreference(STARTED_KEY, true);
}

export function startPractice(sample: SampleId, practicePath: string): void {
  useOnboardingStore.setState({ screen: "practice", sample, practicePath });
}

export function finishOnboarding(): void {
  useOnboardingStore.setState({ open: false, screen: "notes", sample: null, practicePath: null });
  void setPreference(DONE_KEY, true);
}
