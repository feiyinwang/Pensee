import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { useSetting } from "@/hooks/use-settings";

// Not schema entries: whether the Whisper model is on this Mac and the
// ElevenLabs key (kept in the keychain, never in settings.json) belong to the
// system, so these rows only borrow a setting's layout
// (SPECs/talk-notes-spec.md#settings).

interface ModelInfo {
  id: string;
  name: string;
  bytes: number;
  installed: boolean;
}

const BUTTON =
  "h-9 shrink-0 px-3 text-label whitespace-nowrap font-medium transition-colors disabled:opacity-50";
const QUIET = `${BUTTON} rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-subtle-strong)] hover:text-[var(--text-primary)]`;
const PRIMARY = `${BUTTON} rounded-[var(--radius-button)] bg-[var(--text-primary)] text-[var(--bg-base)] hover:opacity-90`;

const size = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function Row({
  title,
  description,
  alert,
  children,
  ...data
}: {
  title: string;
  description: string;
  alert?: boolean;
  children?: React.ReactNode;
  [data: `data-${string}`]: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5" {...data}>
      <div className="min-w-0 flex-1">
        <div className="text-ui font-medium text-[var(--text-primary)]">{title}</div>
        <div
          className="mt-0.5 text-label text-[var(--text-muted)]"
          role={alert ? "alert" : undefined}
        >
          {description}
        </div>
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

function ModelRow({ isShown }: { isShown: boolean }) {
  const id = useSetting("talk.whisper-model") ?? "small";
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isShown) return;
    let live = true;
    invoke<ModelInfo[]>("whisper_models")
      .then((models) => live && setModel(models.find((m) => m.id === id) ?? null))
      .catch((e: unknown) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [id, isShown]);

  const download = async () => {
    if (!model) return;
    setError(null);
    setProgress(0);
    const unlisten = await listen<{ id: string; received: number; total: number }>(
      "whisper:progress",
      ({ payload }) => {
        if (payload.id === model.id)
          setProgress(payload.total ? payload.received / payload.total : 0);
      },
    );
    try {
      await invoke("whisper_download", { id: model.id });
      setModel({ ...model, installed: true });
    } catch (e) {
      setError(`${model.name} didn't download: ${message(e)}`);
    } finally {
      unlisten();
      setProgress(null);
    }
  };

  const description =
    error ??
    (!model
      ? "Checking…"
      : model.installed
        ? `${model.name} is on this Mac.`
        : progress !== null
          ? `Downloading ${model.name}… ${Math.round(progress * 100)}%`
          : `${model.name} isn't on this Mac yet. It downloads once (${size(model.bytes)}) and runs offline after.`);

  return (
    <Row
      title="Model on this Mac"
      description={description}
      alert={Boolean(error)}
      data-whisper-model={model ? (model.installed ? "installed" : "missing") : "checking"}
    >
      {model && !model.installed && (
        <button
          type="button"
          disabled={progress !== null}
          onClick={() => void download()}
          className={PRIMARY}
        >
          {progress !== null ? "Downloading…" : "Download"}
        </button>
      )}
    </Row>
  );
}

type KeyState = "checking" | "none" | "saved";

function ElevenLabsKeyRow({ isShown }: { isShown: boolean }) {
  const [state, setState] = useState<KeyState>("checking");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; alert: boolean } | null>(null);

  const refresh = useCallback(() => {
    invoke<boolean>("elevenlabs_key_saved")
      .then((saved) => setState(saved ? "saved" : "none"))
      .catch((e: unknown) => setNote({ text: message(e), alert: true }));
  }, []);

  useEffect(() => {
    if (isShown) refresh();
  }, [isShown, refresh]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await action();
    } catch (e) {
      setNote({ text: message(e), alert: true });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await invoke("elevenlabs_save_key", { key: draft });
      setDraft("");
      setState("saved");
      setNote({ text: "Saved in your keychain. Check key to try it.", alert: false });
    });
  const check = () =>
    run(async () => {
      await invoke("elevenlabs_check_key");
      setNote({ text: "ElevenLabs accepted the key.", alert: false });
    });
  const remove = () =>
    run(async () => {
      await invoke("elevenlabs_save_key", { key: "" });
      setState("none");
    });

  const description =
    note?.text ??
    (state === "saved"
      ? "Saved in your keychain. Talks are transcribed by ElevenLabs, billed to your account."
      : state === "none"
        ? "Paste an API key from elevenlabs.io → Developers → API Keys. It stays in your keychain."
        : "Checking…");

  return (
    <Row
      title="ElevenLabs API key"
      description={description}
      alert={note?.alert}
      data-elevenlabs-key={state}
    >
      {state === "saved" ? (
        <>
          <button type="button" disabled={busy} onClick={() => void check()} className={QUIET}>
            {busy ? "Checking…" : "Check key"}
          </button>
          <button type="button" disabled={busy} onClick={() => void remove()} className={QUIET}>
            Remove
          </button>
        </>
      ) : state === "none" ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) void save();
          }}
        >
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="ElevenLabs API key"
            placeholder="sk_…"
            autoComplete="off"
            spellCheck={false}
            className="h-9 w-[200px] rounded-lg border border-transparent bg-[var(--surface-input)] px-3 text-label text-[var(--text-secondary)] outline-none focus:border-[var(--focus-border)]"
          />
          <button type="submit" disabled={busy || !draft.trim()} className={PRIMARY}>
            Save
          </button>
        </form>
      ) : null}
    </Row>
  );
}

/** Below the Whisper Model setting: the model's download, and the key when ElevenLabs transcribes. */
export function TranscriptionRows({ isShown }: { isShown: boolean }) {
  const engine = useSetting("talk.engine") ?? "whisper";
  return (
    <>
      <ModelRow isShown={isShown} />
      {engine === "elevenlabs" && (
        <div className="border-t border-[var(--line-subtler)]">
          <ElevenLabsKeyRow isShown={isShown} />
        </div>
      )}
    </>
  );
}
