import { create } from "zustand";
import { getPreference, setPreference } from "@/lib/preferences";

// Whether the transcript box is folded to its header
// (SPECs/youtube-notes-spec.md#transcript-box). One setting for every video
// note, kept in the app's preferences, shared by the box under the video and
// the one beside it so both follow a fold at once.

const KEY = "video.transcriptCollapsed";

interface TranscriptViewState {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

/** Set once the user folds or unfolds, so a slow preference read can't undo it. */
let chosen = false;

export const useTranscriptView = create<TranscriptViewState>((set) => ({
  collapsed: false,
  setCollapsed: (collapsed) => {
    chosen = true;
    set({ collapsed });
    void setPreference(KEY, collapsed);
  },
}));

void getPreference<boolean>(KEY, false).then((collapsed) => {
  if (!chosen) useTranscriptView.setState({ collapsed: collapsed === true });
});
