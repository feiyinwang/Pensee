import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Recorder, microphoneError } from "@/lib/talk/recorder";
import { recordingStem } from "@/lib/talk/clock";
import { insertTalk } from "@/lib/talk/insert-talk";
import {
  type Segment,
  afterTranscriptInsertion,
  transcriptCallout,
  transcriptInsertion,
} from "@/lib/talk/transcript";
import {
  type AskState,
  acceptOffer,
  applyReply,
  emptyAsk,
  keepAside,
  talkSections,
} from "@/lib/talk/ask";
import { type HeardLine, askTalk, endTalk, talkPrompt, warmTalk } from "@/lib/talk/talk-agent";
import { editorViewFor } from "@/lib/editor-views";
import { showEditorNotice } from "@/components/editor-area/editor-notice-store";

// One talk at a time (SPECs/talk-notes-spec.md). The recorder lives here,
// outside React, so closing the note's pane mid-take never drops it.
//
// While it records, its 16 kHz samples go to Rust. Every few seconds Whisper
// transcribes what's new (`talk_transcribe_live`) and the talk's Claude sorts
// those lines into topics (Ask). After Stop, Whisper transcribes the whole
// take; the transcript and the topics go under the take in the note.

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

/** What the live view can do while recording. */
export type LiveStatus = "listening" | "needs-model" | "downloading" | "error";

/** The take waiting for its transcript. */
interface Pending {
  notePath: string;
  file: string;
  session: string;
  /** The live lines and topics, written under the transcript. */
  lines: HeardLine[];
  ask: AskState;
}

export interface ModelInfo {
  id: string;
  name: string;
  bytes: number;
  installed: boolean;
}

interface LiveResult {
  segments: Segment[];
  next: number;
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
  live: LiveStatus;
  liveError: string | null;
  ask: AskState;
  /** A tab you picked; null follows what you're saying. */
  pinned: string | null;
  /** Lets the card undo its last answer, for a few seconds. */
  undo: { before: AskState; key: string; aside: boolean } | null;
  start: (notePath: string) => Promise<void>;
  stop: () => Promise<void>;
  download: () => Promise<void>;
  skipTranscript: () => void;
  dismiss: () => void;
  pin: (key: string | null) => void;
  accept: () => void;
  aside: () => void;
  undoAnswer: () => void;
}

/** How long "Saved to Recordings/" stays before the pill goes back to Record. */
const SAVED_MS = 4000;
/** The free, on-device model (Settings will choose; SPECs/talk-notes-spec.md#transcription). */
const MODEL = "small";
/** How often Whisper looks at what's new while you talk. */
const LIVE_MS = 4000;
/** How long the card offers Undo after an answer. */
const UNDO_MS = 5000;
/** Stop waits this long at most for the last topics before writing the note. */
const LAST_TURN_MS = 20_000;

let recorder: Recorder | null = null;
let session: string | null = null;
/** Sends samples to Rust in order; Stop waits for the last batch. */
let sending: Promise<unknown> = Promise.resolve();
let pending: Pending | null = null;
let savedTimer: ReturnType<typeof setTimeout> | undefined;
let undoTimer: ReturnType<typeof setTimeout> | undefined;
const levelListeners = new Set<(level: number) => void>();

/** The live loop's state for the take being recorded. */
let liveTimer: ReturnType<typeof setInterval> | undefined;
let liveFrom = 0;
let livePass: Promise<void> | null = null;
let heard: HeardLine[] = [];
let toSort: HeardLine[] = [];
let sorting: Promise<void> | null = null;

/** The microphone level while recording, 0–1; returns the unsubscribe. */
export function onTalkLevel(listener: (level: number) => void): () => void {
  levelListeners.add(listener);
  return () => levelListeners.delete(listener);
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, ms))]);

export const useTalkStore = create<TalkState>((set, get) => {
  const finish = () => {
    set({ phase: "saved" });
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => get().phase === "saved" && set({ phase: "idle" }), SAVED_MS);
  };

  /** Sends the lines heard since the last turn to the talk's Claude, one turn at a time. */
  const sort = (): Promise<void> => {
    if (sorting || !toSort.length) return sorting ?? Promise.resolve();
    const batch = toSort.splice(0);
    const { ask } = get();
    const topics = ask.open.map((k) => ({ key: k, title: ask.topics[k]?.title ?? k }));
    sorting = askTalk(talkPrompt(batch, topics, ask.current))
      .then((reply) => set({ ask: applyReply(get().ask, reply), liveError: null }))
      .catch((error: unknown) => set({ liveError: `Topics paused: ${message(error)}` }))
      .finally(() => {
        sorting = null;
        if (toSort.length) void sort();
      });
    return sorting;
  };

  /** One live Whisper pass over what's new; `last` keeps the final words. */
  const listenOnce = (id: string, last = false): Promise<void> => {
    if (livePass) return livePass;
    livePass = invoke<LiveResult>("talk_transcribe_live", {
      session: id,
      model: MODEL,
      from: liveFrom,
      last,
    })
      .then((r) => {
        liveFrom = r.next;
        const lines = r.segments
          .map((s) => ({ n: heard.length, start: s.start, text: s.text }))
          .map((l, i) => ({ ...l, n: heard.length + i }));
        heard.push(...lines);
        toSort.push(...lines);
        void sort();
      })
      .catch((error: unknown) =>
        set({ live: "error", liveError: `Topics paused: ${message(error)}` }),
      )
      .finally(() => {
        livePass = null;
      });
    return livePass;
  };

  const startLive = (id: string) => {
    clearInterval(liveTimer);
    set({ live: "listening" });
    warmTalk();
    liveTimer = setInterval(() => void listenOnce(id), LIVE_MS);
  };

  const stopLive = () => {
    clearInterval(liveTimer);
    liveTimer = undefined;
  };

  const writeTranscript = (take: Pending, segments: Segment[], engine: string) => {
    const view = editorViewFor(take.notePath);
    const callout = transcriptCallout(take.file, segments, engine);
    const at = view && transcriptInsertion(view.state, take.file, callout);
    if (!view || !at) {
      showEditorNotice(
        `The transcript of ${take.file} is ready, but its note was closed or the player was removed.`,
      );
      return;
    }
    view.dispatch({ changes: at, userEvent: "input.talk" });
    const sections = talkSections(take.ask, take.lines, (n) => ({
      file: take.file,
      start: take.lines[n]?.start ?? 0,
    }));
    const below = sections && afterTranscriptInsertion(view.state, take.file, sections);
    if (below) view.dispatch({ changes: below, userEvent: "input.talk" });
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

  const modelInfo = async (): Promise<ModelInfo> => {
    const model = (await invoke<ModelInfo[]>("whisper_models")).find((m) => m.id === MODEL);
    if (!model) throw new Error(`No Whisper model called ${MODEL}.`);
    return model;
  };

  return {
    phase: "idle",
    notePath: null,
    startedAt: null,
    lastFile: null,
    progress: 0,
    model: null,
    error: null,
    live: "listening",
    liveError: null,
    ask: emptyAsk(),
    pinned: null,
    undo: null,

    start: async (notePath) => {
      const busy: TalkPhase[] = ["starting", "recording", "saving", "downloading", "transcribing"];
      if (busy.includes(get().phase)) return;
      clearTimeout(savedTimer);
      if (pending) void invoke("talk_pcm_drop", { session: pending.session });
      pending = null;
      heard = [];
      toSort = [];
      liveFrom = 0;
      set({
        phase: "starting",
        notePath,
        error: null,
        ask: emptyAsk(),
        pinned: null,
        undo: null,
        liveError: null,
      });
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
        const model = await modelInfo();
        set({ model });
        if (model.installed) startLive(id);
        else set({ live: "needs-model" });
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
      stopLive();
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
        const model = await modelInfo();
        if (model.installed) {
          set({ phase: "transcribing" });
          // The last words, then the last topics, before the note is written.
          await livePass;
          await listenOnce(id, true);
          await withTimeout(sort(), LAST_TURN_MS);
        }
        endTalk();
        pending = { notePath, file, session: id, lines: [...heard], ask: get().ask };
        if (model.installed) await transcribe(pending, model);
        else set({ phase: "needs-model", model });
      } catch (error) {
        recorder = null;
        set({ phase: "error", error: `The recording couldn't be saved: ${message(error)}` });
      }
    },

    download: async () => {
      const { model, phase } = get();
      const recording = phase === "recording";
      if (!model || (!pending && !recording)) return;
      if (recording) set({ live: "downloading", progress: 0 });
      else set({ phase: "downloading", progress: 0 });
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
        const installed = { ...model, installed: true };
        set({ model: installed });
        // Still recording: topics start now, from the start of the take.
        if (get().phase === "recording" && session) startLive(session);
        else if (pending) await transcribe(pending, installed);
      } catch (error) {
        unlisten();
        if (get().phase === "recording")
          set({ live: "error", liveError: `${model.name} didn't download: ${message(error)}` });
        else
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

    pin: (key) => set({ pinned: key && key !== get().ask.current ? key : null }),

    accept: () => {
      const before = get().ask;
      if (!before.offer) return;
      set({
        ask: acceptOffer(before),
        pinned: null,
        undo: { before, key: before.offer.key, aside: false },
      });
      clearTimeout(undoTimer);
      undoTimer = setTimeout(() => set({ undo: null }), UNDO_MS);
    },

    aside: () => {
      const before = get().ask;
      if (!before.offer) return;
      set({ ask: keepAside(before), undo: { before, key: before.offer.key, aside: true } });
      clearTimeout(undoTimer);
      undoTimer = setTimeout(() => set({ undo: null }), UNDO_MS);
    },

    undoAnswer: () => {
      const { undo } = get();
      if (!undo) return;
      clearTimeout(undoTimer);
      set({ ask: undo.before, undo: null });
    },
  };
});
