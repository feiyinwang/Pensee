import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Recorder, microphoneError } from "@/lib/talk/recorder";
import { recordingStem } from "@/lib/talk/clock";
import { insertTalk } from "@/lib/talk/insert-talk";
import { type Segment, transcriptCallout, transcriptInsertion } from "@/lib/talk/transcript";
import { editorViewFor } from "@/lib/editor-views";
import { showEditorNotice } from "@/components/editor-area/editor-notice-store";

// One talk at a time (SPECs/talk-notes-spec.md#recording). The recorder lives
// here, outside React, so closing the note's pane mid-take never drops it.
// While it records, its 16 kHz samples go to Rust; after Stop, Whisper
// transcribes them and the transcript goes under the take in the note.

export type TalkPhase =
  | "idle"
  | "starting"
  | "recording"
  | "saving"
  | "needs-model"
  | "downloading"
  | "transcribing"
  | "saved"
  | "error";

/** The take waiting for its transcript. */
interface Pending {
  notePath: string;
  file: string;
  session: string;
}

interface ModelInfo {
  id: string;
  name: string;
  bytes: number;
  installed: boolean;
}

interface TalkState {
  phase: TalkPhase;
  /** The note the take belongs to. */
  notePath: string | null;
  startedAt: number | null;
  /** The last take saved, as the note embeds it. */
  lastFile: string | null;
  /** Download progress of the Whisper model, 0–1. */
  progress: number;
  /** The model a missing-model prompt is about. */
  model: ModelInfo | null;
  error: string | null;
  start: (notePath: string) => Promise<void>;
  stop: () => Promise<void>;
  download: () => Promise<void>;
  skipTranscript: () => void;
  dismiss: () => void;
}

/** How long "Saved to Recordings/" stays before the pill goes back to Record. */
const SAVED_MS = 4000;
/** The free, on-device model (Settings will choose; SPECs/talk-notes-spec.md#transcription). */
const MODEL = "small";

let recorder: Recorder | null = null;
let session: string | null = null;
/** Sends samples to Rust in order; Stop waits for the last batch. */
let sending: Promise<unknown> = Promise.resolve();
let pending: Pending | null = null;
let savedTimer: ReturnType<typeof setTimeout> | undefined;
const levelListeners = new Set<(level: number) => void>();

/** The microphone level while recording, 0–1; returns the unsubscribe. */
export function onTalkLevel(listener: (level: number) => void): () => void {
  levelListeners.add(listener);
  return () => levelListeners.delete(listener);
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useTalkStore = create<TalkState>((set, get) => {
  const finish = () => {
    set({ phase: "saved" });
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => get().phase === "saved" && set({ phase: "idle" }), SAVED_MS);
  };

  const writeTranscript = (take: Pending, segments: Segment[], engine: string) => {
    const view = editorViewFor(take.notePath);
    const callout = transcriptCallout(take.file, segments, engine);
    const at = view && transcriptInsertion(view.state, take.file, callout);
    if (view && at) view.dispatch({ changes: at, userEvent: "input.talk" });
    else
      showEditorNotice(
        `The transcript of ${take.file} is ready, but its note was closed or the player was removed.`,
      );
  };

  const transcribe = async (take: Pending, model: ModelInfo) => {
    set({ phase: "transcribing" });
    try {
      const segments = await invoke<Segment[]>("talk_transcribe", {
        session: take.session,
        model: model.id,
      });
      writeTranscript(take, segments, `On this Mac · ${model.name}`);
      pending = null;
      finish();
    } catch (error) {
      pending = null;
      set({
        phase: "error",
        error: `The take is saved, but it couldn't be transcribed: ${message(error)}`,
      });
    }
  };

  return {
    phase: "idle",
    notePath: null,
    startedAt: null,
    lastFile: null,
    progress: 0,
    model: null,
    error: null,

    start: async (notePath) => {
      const busy: TalkPhase[] = ["starting", "recording", "saving", "downloading", "transcribing"];
      if (busy.includes(get().phase)) return;
      clearTimeout(savedTimer);
      if (pending) void invoke("talk_pcm_drop", { session: pending.session });
      pending = null;
      set({ phase: "starting", notePath, error: null });
      try {
        session = await invoke<string>("talk_pcm_begin");
        const id = session;
        sending = Promise.resolve();
        recorder = await Recorder.start(
          (level) => levelListeners.forEach((l) => l(level)),
          (samples) => {
            const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
            sending = sending
              .then(() => invoke("talk_pcm_append", bytes, { headers: { "x-session": id } }))
              .catch((error: unknown) => console.error("[talk] samples not sent:", error));
          },
        );
        set({ phase: "recording", startedAt: Date.now() });
      } catch (error) {
        recorder = null;
        if (session) void invoke("talk_pcm_drop", { session });
        session = null;
        set({ phase: "error", error: microphoneError(error) });
      }
    },

    stop: async () => {
      const { notePath } = get();
      if (get().phase !== "recording" || !recorder || !notePath || !session) return;
      set({ phase: "saving" });
      const id = session;
      try {
        const take = await recorder.stop();
        recorder = null;
        session = null;
        await sending;
        const bytes = new Uint8Array(await take.blob.arrayBuffer());
        const file = await invoke<string>("save_recording", bytes, {
          headers: {
            "x-stem": encodeURIComponent(recordingStem(take.startedAt)),
            "x-ext": take.ext,
          },
        });
        const view = editorViewFor(notePath);
        if (view) insertTalk(view, file, take.startedAt);
        else
          showEditorNotice(
            `Saved to ${file}. Its note was closed, so the talk wasn't added to it.`,
          );
        set({ lastFile: file });
        pending = { notePath, file, session: id };
        const model = (await invoke<ModelInfo[]>("whisper_models")).find((m) => m.id === MODEL);
        if (!model) throw new Error(`No Whisper model called ${MODEL}.`);
        if (model.installed) await transcribe(pending, model);
        else set({ phase: "needs-model", model });
      } catch (error) {
        recorder = null;
        set({ phase: "error", error: `The recording couldn't be saved: ${message(error)}` });
      }
    },

    download: async () => {
      const { model } = get();
      if (!model || !pending) return;
      set({ phase: "downloading", progress: 0 });
      const unlisten = await listen<{ id: string; received: number; total: number }>(
        "whisper:progress",
        ({ payload }) => {
          if (payload.id === model.id)
            set({ progress: payload.total ? payload.received / payload.total : 0 });
        },
      );
      try {
        await invoke("whisper_download", { id: model.id });
        unlisten();
        await transcribe(pending, { ...model, installed: true });
      } catch (error) {
        unlisten();
        set({
          phase: "error",
          error: `${model.name} didn't download: ${message(error)}. The take is saved; Record again to retry.`,
        });
      }
    },

    skipTranscript: () => {
      if (pending) void invoke("talk_pcm_drop", { session: pending.session });
      pending = null;
      finish();
    },

    dismiss: () => set({ phase: "idle", error: null }),
  };
});
