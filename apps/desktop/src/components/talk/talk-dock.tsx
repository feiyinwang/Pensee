import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { MicOff } from "lucide-react";
import type { RefObject } from "react";
import { onTalkLevel, useTalkStore } from "@/stores/talk-store";
import { formatClock } from "@/lib/talk/clock";
import { useEditorStore } from "@/stores/editor-store";
import { useChromeTooltip } from "../chrome-tooltip";
import "./talk-dock.css";

// Record, at the bottom centre of the note (SPECs/talk-notes-spec.md#recording;
// placed like Granola's, approved 2026-10-25). Capture only: playback lives
// on the audio embed in the note. At rest it is a red dot that steps aside
// while you scroll or write (decided from proto/record-dock, 2026-10-27).

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

/** How long after the last scroll or keystroke Record comes back. */
const STEP_ASIDE_MS = 1500;
/** How near (px, up or down) the pointer has to come to bring Record back at once. */
const STEP_ASIDE_NEAR = 64;

/**
 * Marks `ref`'s element `data-tucked` while you scroll or type in its pane, so
 * the CSS can fade it off the text; it comes back after a pause or when the
 * pointer nears it. Written to the DOM, so scrolling never re-renders React.
 */
function useStepAside(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    const pane = element?.closest("[data-pane]");
    if (!element || !pane) return;
    let timer = 0;
    const near = (event: Event) => {
      const { clientX, clientY } = event as PointerEvent;
      const box = element.getBoundingClientRect();
      if (
        Math.abs(clientY - (box.top + box.height / 2)) < STEP_ASIDE_NEAR &&
        Math.abs(clientX - (box.left + box.width / 2)) < Math.max(box.width, 160)
      ) {
        back();
      }
    };
    const back = () => {
      window.clearTimeout(timer);
      element.removeAttribute("data-tucked");
      pane.removeEventListener("pointermove", near);
    };
    const aside = () => {
      if (!element.hasAttribute("data-tucked")) {
        element.setAttribute("data-tucked", "");
        pane.addEventListener("pointermove", near);
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(back, STEP_ASIDE_MS);
    };
    // Scroll doesn't bubble, so the pane listens in the capture phase.
    pane.addEventListener("scroll", aside, { capture: true, passive: true });
    pane.addEventListener("input", aside, true);
    return () => {
      back();
      pane.removeEventListener("scroll", aside, { capture: true });
      pane.removeEventListener("input", aside, true);
    };
  }, [ref]);
}

function RecordDot({ path }: { path: string }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const tip = useChromeTooltip("Record", { side: "top" });
  useStepAside(ref);
  return (
    <>
      <button
        type="button"
        {...tip.triggerProps}
        ref={(node) => {
          ref.current = node;
          tip.triggerProps.ref(node);
        }}
        className="talk-dock-dot-button"
        onClick={() => void useTalkStore.getState().start(path)}
      >
        <span className="talk-dock-dot" aria-hidden="true" />
        <span className="sr-only">Record</span>
      </button>
      {tip.tooltip}
    </>
  );
}

/** The pill after a take: Saved, Continue, New talk. Steps aside like the dot. */
function AfterTake({ path, saved, talking }: { path: string; saved: boolean; talking: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useStepAside(ref);
  return (
    <div ref={ref} className="talk-dock-pill">
      {saved && <span className="talk-dock-note">Saved to Recordings/</span>}
      {talking ? (
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
  const silent = useTalkStore((s) => s.silent);
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
  // A take whose note isn't on screen (left in its tab, or in a tab behind
  // this one): the pill follows you, naming that note while it records, so
  // the microphone is never on with no Stop in sight and what Stop asks next
  // (a download, an error) isn't left on a note you can't see. In columns
  // the note's own column shows its pill.
  const elsewhere = (busy || phase === "error") && !mine && isActive && (!inColumn || !noteInTab);
  // A take shows on its own note; otherwise Record shows on the note you're in.
  if (!elsewhere && (busy ? !mine : !isActive)) return null;

  return (
    <div
      className="talk-dock"
      role="region"
      aria-label="Record"
      data-in-column={inColumn || undefined}
    >
      {phase === "recording" && mine && (
        <Suspense fallback={null}>
          <TalkBox />
        </Suspense>
      )}
      {phase === "recording" && startedAt && silent && (
        // Above the pill, as its own card: what's wrong and where to fix it.
        <div className="talk-dock-alert" role="alert">
          <MicOff className="talk-dock-alert-icon" aria-hidden="true" />
          <span>
            <strong>No sound from the microphone.</strong> Allow Pensée in System Settings → Privacy
            &amp; Security → Microphone.
          </span>
        </div>
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
      ) : phase === "error" && (mine || elsewhere) ? (
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
      ) : talk?.notePath === path || (phase === "saved" && mine) ? (
        <AfterTake
          path={path}
          saved={phase === "saved" && mine}
          talking={talk?.notePath === path}
        />
      ) : (
        <RecordDot path={path} />
      )}
    </div>
  );
}
