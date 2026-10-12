import { create } from "zustand";
import { getPreference, setPreference } from "@/lib/preferences";
import type { SpaceView } from "@/lib/spaces";

// The view picked last in each space that offers several
// (SPECs/project-views-spec.md), kept across launches.

const PREFERENCE_KEY = "spaces.views";

interface SpaceViewState {
  /** By space key; a space missing here shows its first view. */
  views: Record<string, SpaceView>;
  setView: (space: string, view: SpaceView) => void;
}

export const useSpaceViewStore = create<SpaceViewState>((set, get) => ({
  views: {},
  setView: (space, view) => {
    const views = { ...get().views, [space]: view };
    set({ views });
    void setPreference(PREFERENCE_KEY, views);
  },
}));

void getPreference<Record<string, SpaceView>>(PREFERENCE_KEY, {}).then((saved) => {
  // A pick made before the file loaded wins over the saved one.
  useSpaceViewStore.setState((state) => ({ views: { ...saved, ...state.views } }));
});
