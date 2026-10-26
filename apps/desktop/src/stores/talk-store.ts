import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { Recorder, microphoneError } from "@/lib/talk/recorder";
import { recordingStem } from "@/lib/talk/clock";
import { insertTalk } from "@/lib/talk/insert-talk";
import { editorViewFor } from "@/lib/editor-views";
import { showEditorNotice } from "@/components/editor-area/editor-notice-store";

// One talk at a time (SPECs/talk-notes-spec.md#recording). The recorder lives
// here, outside React, so closing the note's pane mid-take never drops it.

export type TalkPhase = "idle" | "starting" | "recording" | "saving" | "saved" | "error";

interface TalkState {
  phase: TalkPhase;
  /** The note the take belongs to. */
  notePath: string | null;
  startedAt: number | null;
  /** The last take saved, as the note embeds it. */
  lastFile: string | null;
  error: string | null;
  start: (notePath: string) => Promise<void>;
  stop: () => Promise<void>;
  dismiss: () => void;
}

/** How long "Saved to Recordings/" stays before the pill goes back to Record. */
const SAVED_MS = 4000;

let recorder: Recorder | null = null;
let savedTimer: ReturnType<typeof setTimeout> | undefined;
const levelListeners = new Set<(level: number) => void>();

/** The microphone level while recording, 0–1; returns the unsubscribe. */
export function onTalkLevel(listener: (level: number) => void): () => void {
  levelListeners.add(listener);
  return () => levelListeners.delete(listener);
}

export const useTalkStore = create<TalkState>((set, get) => ({
  phase: "idle",
  notePath: null,
  startedAt: null,
  lastFile: null,
  error: null,

  start: async (notePath) => {
    if (get().phase === "starting" || get().phase === "recording" || get().phase === "saving")
      return;
    clearTimeout(savedTimer);
    set({ phase: "starting", notePath, error: null });
    try {
      recorder = await Recorder.start((level) => levelListeners.forEach((l) => l(level)));
      set({ phase: "recording", startedAt: Date.now() });
    } catch (error) {
      recorder = null;
      set({ phase: "error", error: microphoneError(error) });
    }
  },

  stop: async () => {
    const { notePath } = get();
    if (get().phase !== "recording" || !recorder || !notePath) return;
    set({ phase: "saving" });
    try {
      const take = await recorder.stop();
      recorder = null;
      const bytes = new Uint8Array(await take.blob.arrayBuffer());
      const file = await invoke<string>("save_recording", bytes, {
        headers: { "x-stem": encodeURIComponent(recordingStem(take.startedAt)), "x-ext": take.ext },
      });
      const view = editorViewFor(notePath);
      if (view) insertTalk(view, file, take.startedAt);
      else
        showEditorNotice(`Saved to ${file}. Its note was closed, so the talk wasn't added to it.`);
      set({ phase: "saved", lastFile: file });
      savedTimer = setTimeout(() => get().phase === "saved" && set({ phase: "idle" }), SAVED_MS);
    } catch (error) {
      recorder = null;
      set({
        phase: "error",
        error: `The recording couldn't be saved: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },

  dismiss: () => set({ phase: "idle", error: null }),
}));
