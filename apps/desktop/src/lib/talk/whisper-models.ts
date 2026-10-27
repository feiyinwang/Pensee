import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "@/stores/settings-store";

// The Whisper models on this Mac (SPECs/talk-notes-spec.md#transcription).
// Large v3 Turbo is the default: it hears accents and quiet rooms better.
// It's 1.6 GB, so a first talk doesn't wait for it: Pensée starts with Small
// (488 MB, smaller but faster to get), downloads Turbo in the background, and
// switches as soon as it lands. One download per model at a time, shared by
// the talk and Settings → Transcription.

export interface ModelInfo {
  id: string;
  name: string;
  bytes: number;
  installed: boolean;
}

/** What a first talk starts with while the chosen model downloads. */
export const STARTER = "small";

/** The download running now, for the talk and Settings to show. */
export const useWhisperDownload = create<{ id: string | null; progress: number }>(() => ({
  id: null,
  progress: 0,
}));

export const whisperModels = () => invoke<ModelInfo[]>("whisper_models");

/** Whether `id` is Small standing in for the bigger model chosen in Settings. */
export const startsSmall = (id: string): boolean =>
  id === STARTER &&
  (useSettingsStore.getState().getSetting("talk.whisper-model") ?? "turbo") !== STARTER;

const running = new Map<string, Promise<void>>();

/** Downloads a model, once however many ask; resolves when it's on this Mac. */
export function downloadModel(id: string): Promise<void> {
  let run = running.get(id);
  if (run) return run;
  run = (async () => {
    useWhisperDownload.setState({ id, progress: 0 });
    const unlisten = await listen<{ id: string; received: number; total: number }>(
      "whisper:progress",
      ({ payload }) => {
        if (payload.id === id)
          useWhisperDownload.setState({
            progress: payload.total ? payload.received / payload.total : 0,
          });
      },
    );
    try {
      await invoke("whisper_download", { id });
    } finally {
      unlisten();
      if (useWhisperDownload.getState().id === id)
        useWhisperDownload.setState({ id: null, progress: 0 });
      running.delete(id);
    }
  })();
  running.set(id, run);
  return run;
}

/**
 * The model to transcribe with now, given the one chosen in Settings: the
 * chosen one when it's on this Mac; otherwise Small, so the talk doesn't
 * wait (installed or not: Small is what a missing-model prompt fetches), with
 * the chosen one as `later` to download in the background.
 */
export async function modelNow(
  chosen: string,
): Promise<{ now: ModelInfo; later: ModelInfo | null }> {
  const models = await whisperModels();
  const want = models.find((m) => m.id === chosen);
  if (!want) throw new Error(`No Whisper model called ${chosen}.`);
  if (want.installed || want.id === STARTER) return { now: want, later: null };
  const starter = models.find((m) => m.id === STARTER);
  if (!starter) return { now: want, later: null };
  return { now: starter, later: want };
}
