import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { onTalkLevel, useTalkStore } from "@/stores/talk-store";
import { formatClock } from "@/lib/talk/clock";
import { useEditorStore } from "@/stores/editor-store";
import "./talk-dock.css";

// Record, at the bottom centre of the note (SPECs/talk-notes-spec.md#recording;
// placed like Granola's, approved 2026-10-25). Capture only: playback lives
// on the audio embed in the note.

/** Levels shown, newest on the right: about half a second at ~30 a second. */
const METER_BARS = 16;
/** How far a bar may fall per level, so a word's tail fades instead of snapping off. */
const METER_FALL = 0.12;
/** Loaded with the first take: Arc, motion and affectUI stay out of startup. */
const TalkBox = lazy(() => import("./talk-box"));

function Meter() {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  // Written straight to the bars, ~30 times a second, so the level never
  // re-renders React. Each level shifts the trace one bar left.
  useEffect(() => {
    const history = Array.from({ length: METER_BARS }, () => 0);
    return onTalkLevel((level) => {
      const last = history[METER_BARS - 1];
      history.shift();
      history.push(Math.max(level, last - METER_FALL));
      bars.current.forEach((bar, i) => {
        if (bar) bar.style.transform = `scaleY(${Math.max(0.12, history[i])})`;
      });
    });
  }, []);
  return (
    <span className="talk-dock-meter" aria-hidden="true" data-talk-meter="">
      {Array.from({ length: METER_BARS }, (_, i) => (
        <span key={i} ref={(el) => void (bars.current[i] = el)} />
      ))}
    </span>
  );
}

const noteName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return <span className="talk-dock-time">{formatClock((now - since) / 1000)}</span>;
}

export function TalkDock({
  path,
  isActive,
  inColumn,
}: {
  path: string;
  isActive: boolean;
  inColumn: boolean;
}) {
  const phase = useTalkStore((s) => s.phase);
  const notePath = useTalkStore((s) => s.notePath);
  const startedAt = useTalkStore((s) => s.startedAt);
  const error = useTalkStore((s) => s.error);
  const progress = useTalkStore((s) => s.progress);
  const model = useTalkStore((s) => s.model);
  const talk = useTalkStore((s) => s.talk);
  const busy = [
    "starting",
    "recording",
    "saving",
    "needs-model",
    "downloading",
    "transcribing",
  ].includes(phase);
  // Whether any tab shows the note being recorded (a boolean, so tab changes
  // elsewhere don't re-render the dock).
  const noteInTab = useEditorStore((s) =>
    s.tabs.some((tab) => tab.location.kind === "file" && tab.location.path === notePath),
  );
  const mine = notePath === path;
  // Recording a note that isn't on screen (left in its tab, or in a tab behind
  // this one): the pill follows you, naming that note, so the microphone is
  // never on with no Stop in sight. In columns its own column shows its pill.
  const elsewhere = phase === "recording" && !mine && isActive && (!inColumn || !noteInTab);
  // A take shows on its own note; otherwise Record shows on the note you're in.
  if (!elsewhere && (busy ? !mine : !isActive)) return null;

  return (
    <div className="talk-dock" role="region" aria-label="Record">
      {phase === "recording" && mine && (
        <Suspense fallback={null}>
          <TalkBox />
        </Suspense>
      )}
      {phase === "recording" && startedAt ? (
        <div className="talk-dock-pill" data-recording="">
          <span className="talk-dock-dot" aria-hidden="true" />
          <Meter />
          <Elapsed since={startedAt} />
          {elsewhere && notePath && (
            <span className="talk-dock-where">in {noteName(notePath)}</span>
          )}
          <button
            type="button"
            className="talk-dock-button"
            onClick={() => void useTalkStore.getState().stop()}
          >
            Stop
          </button>
        </div>
      ) : phase === "starting" || phase === "saving" || phase === "transcribing" ? (
        <div className="talk-dock-pill" aria-live="polite">
          <span className="talk-dock-note">
            {phase === "starting" ? "Starting…" : phase === "saving" ? "Saving…" : "Transcribing…"}
          </span>
        </div>
      ) : phase === "needs-model" && model ? (
        <div className="talk-dock-pill" role="dialog" aria-label="Transcribe on this Mac">
          <span className="talk-dock-note">
            Saved. To transcribe it on this Mac, Pensée downloads {model.name} once (
            {Math.round(model.bytes / 1e6)} MB).
          </span>
          <button
            type="button"
            className="talk-dock-button talk-dock-primary"
            onClick={() => void useTalkStore.getState().download()}
          >
            Download
          </button>
          <button
            type="button"
            className="talk-dock-button"
            onClick={() => useTalkStore.getState().skipTranscript()}
          >
            Not now
          </button>
        </div>
      ) : phase === "downloading" && model ? (
        <div className="talk-dock-pill" aria-live="polite">
          <span className="talk-dock-note">
            Downloading {model.name} ·{" "}
            <span className="talk-dock-time">{Math.floor(progress * 100)}%</span>
          </span>
        </div>
      ) : phase === "error" && mine ? (
        <div className="talk-dock-pill talk-dock-error" role="alert">
          <span className="talk-dock-note">{error}</span>
          <button
            type="button"
            className="talk-dock-button"
            onClick={() => useTalkStore.getState().dismiss()}
          >
            OK
          </button>
        </div>
      ) : (
        <div className="talk-dock-pill">
          {phase === "saved" && mine && (
            <span className="talk-dock-note">Saved to Recordings/</span>
          )}
          {talk?.notePath === path ? (
            <>
              <button
                type="button"
                className="talk-dock-button talk-dock-record"
                onClick={() => void useTalkStore.getState().start(path, true)}
              >
                <span className="talk-dock-dot" aria-hidden="true" />
                Continue
              </button>
              <button
                type="button"
                className="talk-dock-button"
                onClick={() => void useTalkStore.getState().start(path)}
              >
                New talk
              </button>
            </>
          ) : (
            <button
              type="button"
              className="talk-dock-button talk-dock-record"
              onClick={() => void useTalkStore.getState().start(path)}
            >
              <span className="talk-dock-dot" aria-hidden="true" />
              Record
            </button>
          )}
        </div>
      )}
    </div>
  );
}
