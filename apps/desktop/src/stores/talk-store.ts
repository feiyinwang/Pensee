import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Recorder, microphoneError } from "@/lib/talk/recorder";
import { recordingStem } from "@/lib/talk/clock";
import { EditorState } from "@codemirror/state";
import { insertTalk, talkInsertion } from "@/lib/talk/insert-talk";
import { minimalChange } from "@/lib/block-refs";
import { audioClipLink } from "@/lib/audio-clips";
import type { Topic } from "@/lib/talk/ask";
import { editPage } from "@/components/editor-area/linked-block-sync";
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
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorStore } from "@/stores/editor-store";

// One talk at a time (SPECs/talk-notes-spec.md). The recorder lives here,
// outside React, so closing the note's pane mid-take never drops it.
//
// While it records, its 16 kHz samples go to Rust. Every few seconds Whisper
// transcribes what's new (`talk_transcribe_live`) and the talk's Claude sorts
// those lines into topics (Ask). After Stop, Whisper (or ElevenLabs Scribe,
// per Settings → Transcription) transcribes the whole take; the transcript
// and the topics go under the take in the note.

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
  /** Each take's file, and which take each line was heard in. */
  takes: string[];
  takeOfLine: number[];
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
  /** The talk the last take belongs to, so Continue can add the next take to it. */
  talk: { notePath: string; takes: number } | null;
  /** Nothing but silence from the microphone since Record: it isn't allowed, or is muted. */
  silent: boolean;
  start: (notePath: string, continueTalk?: boolean) => Promise<void>;
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
/** Settings → Transcription (SPECs/talk-notes-spec.md#transcription). */
const whisperModel = () => useSettingsStore.getState().getSetting("talk.whisper-model") ?? "small";
const usesScribe = () => useSettingsStore.getState().getSetting("talk.engine") === "elevenlabs";
const SCRIBE = "ElevenLabs Scribe";
/** How often Whisper looks at what's new while you talk. */
const LIVE_MS = 4000;
/** How long the card offers Undo after an answer. */
const UNDO_MS = 5000;
/** Stop waits this long at most for the last topics before writing the note. */
const LAST_TURN_MS = 20_000;

let recorder: Recorder | null = null;
/** Topic boards (topic-boards.ts), loaded with the first topic. */
let boards: typeof import("@/lib/talk/topic-boards") | null = null;
const loadBoards = async () => (boards ??= await import("@/lib/talk/topic-boards"));
let session: string | null = null;
/** Sends samples to Rust in order; Stop waits for the last batch. */
let sending: Promise<unknown> = Promise.resolve();
let pending: Pending | null = null;
let savedTimer: ReturnType<typeof setTimeout> | undefined;
let undoTimer: ReturnType<typeof setTimeout> | undefined;
const levelListeners = new Set<(level: number) => void>();

const showing = (path: string) =>
  useEditorStore
    .getState()
    .tabs.filter((tab) => tab.location.kind === "file" && tab.location.path === path)
    .map((tab) => tab.id);
/** The tabs that showed the take's note at Record. Going to another note in
 *  one of them keeps recording (the pill follows you); closing them ends it. */
let recordingTabs = new Set<string>();
const noteTitle = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
/** Whether the take's note is closed: no tab shows it and its tabs are gone. */
const noteClosed = (path: string) => {
  const tabs = useEditorStore.getState().tabs;
  return !showing(path).length && !tabs.some((tab) => recordingTabs.has(tab.id));
};
let watchingTabs = false;
/** A take ends with its note: closing the note's tab stops and saves it, so
 *  the microphone is never left on with no Stop on screen. Subscribed on the
 *  first Record, not at load, since the editor store's modules import this one. */
function stopWhenNoteCloses() {
  if (watchingTabs) return;
  watchingTabs = true;
  useEditorStore.subscribe((state, prev) => {
    if (state.tabs === prev.tabs) return;
    const { phase, notePath } = useTalkStore.getState();
    if (phase === "recording" && notePath && noteClosed(notePath))
      void useTalkStore.getState().stop();
  });
}

/** The live loop's state for the take being recorded. */
let liveTimer: ReturnType<typeof setInterval> | undefined;
let liveFrom = 0;
let livePass: Promise<void> | null = null;
let heard: HeardLine[] = [];
/** The talk's takes so far (files), which take each heard line belongs to, and the topics last written. */
let takes: string[] = [];
let takeOfLine: number[] = [];
let sectionsWritten: string | null = null;
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
  /** A topic's node words → the clip of the lines it came from: from its first
   *  line to where its last one ends, in the take the first line is in. */
  const clipLinks = (topic: Topic, lastTakeSeconds: number) => {
    const norm = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
    const byWords = new Map(
      Object.entries(topic.sources ?? {}).map(([label, ns]) => [norm(label), ns]),
    );
    return (label: string): string | undefined => {
      const ns = byWords.get(norm(label));
      if (!ns?.length) return undefined;
      const take = takeOfLine[Math.min(...ns)];
      const file = take === undefined ? undefined : takes[take];
      const same = ns.filter((n) => takeOfLine[n] === take && heard[n]).sort((a, b) => a - b);
      if (!file || !same.length) return undefined;
      const start = heard[same[0]!]!.start;
      const last = same[same.length - 1]!;
      const next = heard[last + 1];
      const end =
        next && takeOfLine[last + 1] === take
          ? next.start
          : take === takes.length - 1
            ? lastTakeSeconds
            : heard[last]!.start + 15;
      return audioClipLink(file, start, Math.max(end, start + 1));
    };
  };

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
    const topics = ask.open.map((k) => ({
      key: k,
      title: ask.topics[k]?.title ?? k,
      // A board shows the AI how it is now, with what you changed by hand.
      mermaid: boards?.topicBoardMermaid(k) ?? ask.topics[k]?.mermaid ?? "",
    }));
    sorting = askTalk(talkPrompt(batch, topics, ask.current))
      .then((reply) => {
        set({ ask: applyReply(get().ask, reply), liveError: null });
        const { notePath } = get();
        if (!notePath || !reply.topics.length) return;
        void loadBoards().then((m) => {
          for (const t of reply.topics) void m.syncTopicBoard(t.key, t.mermaid, notePath);
        });
      })
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
      model: get().model?.id ?? whisperModel(),
      from: liveFrom,
      last,
    })
      .then((r) => {
        liveFrom = r.next;
        const lines = r.segments
          .map((s) => ({ n: heard.length, start: s.start, text: s.text }))
          .map((l, i) => ({ ...l, n: heard.length + i }));
        heard.push(...lines);
        takeOfLine.push(...lines.map(() => takes.length));
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

  /** The note's text with the take's transcript under its player and the
   *  talk's topics under that, or null when the player is gone. */
  const withTranscript = (
    doc: string,
    take: Pending,
    callout: string,
    boardOf: (key: string) => string | null,
  ): string | null => {
    const at = transcriptInsertion(EditorState.create({ doc }), take.file, callout);
    if (!at) return null;
    let state = EditorState.create({ doc }).update({ changes: at }).state;
    const sections = talkSections(
      take.ask,
      take.lines,
      (n) => ({
        file: take.takes[take.takeOfLine[n] ?? 0] ?? take.file,
        start: take.lines[n]?.start ?? 0,
      }),
      boardOf,
    );
    if (sections) {
      // A later take rewrites the talk's topics in place, if you haven't edited them.
      const text = state.doc.toString();
      const old = sectionsWritten ? text.indexOf(sectionsWritten) : -1;
      const change =
        sectionsWritten && old >= 0
          ? { from: old, to: old + sectionsWritten.length, insert: sections }
          : afterTranscriptInsertion(state, take.file, sections);
      if (change) state = state.update({ changes: change }).state;
      sectionsWritten = sections;
    }
    return state.doc.toString();
  };

  const writeTranscript = async (take: Pending, segments: Segment[], engine: string) => {
    const callout = transcriptCallout(take.file, segments, engine);
    // The boards' embeds, once their last drawings have landed.
    const embeds = new Map<string, string>();
    if (boards)
      for (const key of take.ask.open) {
        const relative = await boards.topicBoardEmbed(key);
        if (relative) embeds.set(key, relative);
      }
    const boardOf = (key: string) => embeds.get(key) ?? null;
    const view = editorViewFor(take.notePath);
    const gone = () =>
      showEditorNotice(
        `The transcript of ${take.file} is ready, but its player was removed from the note.`,
      );
    if (view) {
      const doc = view.state.doc.toString();
      const next = withTranscript(doc, take, callout, boardOf);
      const change = next === null ? null : minimalChange(doc, next);
      if (next === null) gone();
      else if (change) view.dispatch({ changes: change, userEvent: "input.talk" });
      return;
    }
    // You left the note, or closed it, while it was being written: into its file.
    let missing = false;
    await editPage(take.notePath, (page) => {
      const body = withTranscript(page.body, take, callout, boardOf);
      missing = body === null;
      return body === null ? page : { ...page, body };
    });
    if (missing) gone();
  };

  /** The whole take: Whisper from the samples it heard, or Scribe from the saved file. */
  const transcribe = async (take: Pending, model: ModelInfo | null) => {
    set({ phase: "transcribing" });
    try {
      let segments: Segment[];
      if (model) {
        segments = await invoke<Segment[]>("talk_transcribe", {
          session: take.session,
          model: model.id,
        });
      } else {
        void invoke("talk_pcm_drop", { session: take.session });
        segments = await invoke<Segment[]>("elevenlabs_transcribe", { file: take.file });
      }
      await writeTranscript(take, segments, model ? `On this Mac · ${model.name}` : SCRIBE);
      pending = null;
      set({ talk: { notePath: take.notePath, takes: take.takes.length } });
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
    const id = whisperModel();
    const model = (await invoke<ModelInfo[]>("whisper_models")).find((m) => m.id === id);
    if (!model) throw new Error(`No Whisper model called ${id}.`);
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
    talk: null,
    silent: false,

    start: async (notePath, continueTalk = false) => {
      const busy: TalkPhase[] = ["starting", "recording", "saving", "downloading", "transcribing"];
      if (busy.includes(get().phase)) return;
      clearTimeout(savedTimer);
      if (pending) void invoke("talk_pcm_drop", { session: pending.session });
      pending = null;
      const carryOn = continueTalk && get().talk?.notePath === notePath;
      if (!carryOn) {
        heard = [];
        boards?.resetTopicBoards();
        takes = [];
        takeOfLine = [];
        sectionsWritten = null;
      }
      toSort = [];
      liveFrom = 0;
      set({
        phase: "starting",
        notePath,
        error: null,
        ...(carryOn ? {} : { ask: emptyAsk(), talk: null }),
        pinned: null,
        undo: null,
        liveError: null,
        silent: false,
      });
      recordingTabs = new Set(showing(notePath));
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
          (silent) => set({ silent }),
        );
        set({ phase: "recording", startedAt: Date.now() });
        stopWhenNoteCloses();
        // Closed while the microphone was starting.
        if (noteClosed(notePath)) return void get().stop();
        const model = await modelInfo();
        set({ model });
        if (model.installed) startLive(id);
        else set({ live: "needs-model" });
      } catch (error) {
        // Started but a later step failed: release the microphone, don't just drop it.
        recorder?.cancel();
        recorder = null;
        stopLive();
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
        const previous = takes[takes.length - 1];
        takes.push(file);
        // A Continue goes under the talk's last take (its transcript, if it has one); a new talk gets its heading.
        const under =
          previous && view ? afterTranscriptInsertion(view.state, previous, `![[${file}]]`) : null;
        if (view && under) view.dispatch({ changes: under, userEvent: "input.talk" });
        else if (view) insertTalk(view, file, take.startedAt);
        else {
          // You left the note, or closed it, while recording: the talk goes
          // into its file, at the end (there is no caret to put it after).
          await editPage(notePath, (page) => {
            const state = EditorState.create({
              doc: page.body,
              selection: { anchor: page.body.length },
            });
            const change =
              (previous && afterTranscriptInsertion(state, previous, `![[${file}]]`)) ||
              talkInsertion(state, file, take.startedAt);
            return { ...page, body: state.update({ changes: change }).state.doc.toString() };
          });
          showEditorNotice(`The talk went into ${noteTitle(notePath)}, which you'd left.`);
        }
        set({ lastFile: file, talk: { notePath, takes: takes.length } });
        const model = await modelInfo();
        if (model.installed) {
          set({ phase: "transcribing" });
          // The last words, then the last topics, before the note is written.
          await livePass;
          await listenOnce(id, true);
          await withTimeout(sort(), LAST_TURN_MS);
        }
        // Each board node plays the part of the take it came from.
        if (boards) {
          const { ask } = get();
          for (const key of ask.open) {
            const topic = ask.topics[key];
            if (topic?.sources) void boards.attachClips(key, clipLinks(topic, take.seconds));
          }
        }
        endTalk();
        pending = {
          notePath,
          file,
          session: id,
          lines: [...heard],
          ask: get().ask,
          takes: [...takes],
          takeOfLine: [...takeOfLine],
        };
        // Scribe once its key is saved; Whisper until then.
        const scribe = usesScribe() && (await invoke<boolean>("elevenlabs_key_saved"));
        if (scribe) await transcribe(pending, null);
        else if (model.installed) await transcribe(pending, model);
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
