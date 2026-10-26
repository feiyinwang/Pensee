import { useEffect, useRef, useState } from "react";
import { onTalkLevel, useTalkStore } from "@/stores/talk-store";
import { formatClock } from "@/lib/talk/clock";
import "./talk-dock.css";

// Record, at the bottom centre of the note (SPECs/talk-notes-spec.md#recording;
// placed like Granola's, approved 2026-10-25). Capture only: playback lives
// on the audio embed in the note.

const METER_BARS = 5;

function Meter() {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  // Written straight to the bars, ~30 times a second, so the level never re-renders React.
  useEffect(
    () =>
      onTalkLevel((level) => {
        bars.current.forEach((bar, i) => {
          if (!bar) return;
          const shape = 0.55 + 0.45 * Math.sin((i + 1) * 1.7);
          bar.style.transform = `scaleY(${Math.max(0.15, Math.min(1, level * shape * 1.6))})`;
        });
      }),
    [],
  );
  return (
    <span className="talk-dock-meter" aria-hidden="true">
      {Array.from({ length: METER_BARS }, (_, i) => (
        <span key={i} ref={(el) => void (bars.current[i] = el)} />
      ))}
    </span>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return <span className="talk-dock-time">{formatClock((now - since) / 1000)}</span>;
}

export function TalkDock({ path, isActive }: { path: string; isActive: boolean }) {
  const phase = useTalkStore((s) => s.phase);
  const notePath = useTalkStore((s) => s.notePath);
  const startedAt = useTalkStore((s) => s.startedAt);
  const error = useTalkStore((s) => s.error);
  const busy = phase === "starting" || phase === "recording" || phase === "saving";
  const mine = notePath === path;
  // A take shows on its own note; otherwise Record shows on the note you're in.
  if (busy ? !mine : !isActive) return null;

  return (
    <div className="talk-dock" role="region" aria-label="Record">
      {phase === "recording" && startedAt ? (
        <div className="talk-dock-pill" data-recording="">
          <span className="talk-dock-dot" aria-hidden="true" />
          <Meter />
          <Elapsed since={startedAt} />
          <button
            type="button"
            className="talk-dock-button"
            onClick={() => void useTalkStore.getState().stop()}
          >
            Stop
          </button>
        </div>
      ) : phase === "starting" || phase === "saving" ? (
        <div className="talk-dock-pill" aria-live="polite">
          <span className="talk-dock-note">{phase === "starting" ? "Starting…" : "Saving…"}</span>
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
          <button
            type="button"
            className="talk-dock-button talk-dock-record"
            onClick={() => void useTalkStore.getState().start(path)}
          >
            <span className="talk-dock-dot" aria-hidden="true" />
            Record
          </button>
        </div>
      )}
    </div>
  );
}
