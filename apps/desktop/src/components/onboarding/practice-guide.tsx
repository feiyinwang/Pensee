import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EditorView } from "@codemirror/view";
import { PIN_SHORTCUT_LABEL } from "@/components/editor-area/video-pin";
import { editorPath } from "@/lib/editor-views";
import { formatVideoTime } from "@/lib/video-pins";
import { seekVideo, videoPlayerFor } from "@/lib/video-players";
import { useEditorStore } from "@/stores/editor-store";
import { useClaudeSignInStore } from "@/stores/claude-sign-in-store";
import { goToScreen, useOnboardingStore } from "./onboarding-store";
import { SAMPLES, type Sample } from "./samples";

/** Where the writer is in the practice loop, read from the note itself: the
 *  pin or highlight they brought in, then the pen's lines by their ids. */
type Step = "capture" | "pen" | "take" | "done";

const PEN_DONE: Record<Sample["pill"], RegExp> = {
  "!": /\^ai-r-/,
  "@": /\^ai-[pn]-/,
  "[[": /\^ai-e-/,
};

function stepOf(sample: Sample, body: string): Step {
  if (sample.capture === "pin" && !/\^yt-\d/.test(body)) return "capture";
  if (sample.capture === "highlight" && !/\^bk-/.test(body)) return "capture";
  if (PEN_DONE[sample.pill].test(body)) return "done";
  if (sample.pill === "!" && /\^ai-s-/.test(body)) return "take";
  return "pen";
}

const Keys = ({ keys }: { keys: string[] }) => (
  <>
    {keys.map((k) => (
      <kbd key={k}>{k}</kbd>
    ))}
  </>
);

/** The empty first bullet a pin sample's note opens with: where Pensée
 *  writes the line for the writer. */
function emptyBullet(view: EditorView): number | null {
  const doc = view.state.doc;
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    if (/^\s*-\s*$/.test(line.text)) return line.to;
    if (/^\s*-\s*\S/.test(line.text)) return null;
  }
  return null;
}

/** Types `text` into `view` at `from`, a character at a time; a key the
 *  writer presses stops it. Returns a cancel function. */
function typeInto(view: EditorView, from: number, text: string, onDone: () => void): () => void {
  let at = 0;
  const pad = view.state.doc.sliceString(from - 1, from) === " " ? "" : " ";
  // Typed out only when someone can watch: all at once under reduced motion
  // or in a hidden window (which also holds its timers back).
  if (document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const insert = pad + text;
    view.dispatch({ changes: { from, insert }, selection: { anchor: from + insert.length } });
    onDone();
    return () => {};
  }
  const stop = () => {
    window.clearInterval(timer);
    view.contentDOM.removeEventListener("keydown", stop);
    onDone();
  };
  const timer = window.setInterval(() => {
    if (!view.dom.isConnected) return stop();
    const ch = (at === 0 ? pad : "") + text[at]!;
    const pos = from + (at === 0 ? 0 : pad.length + at);
    view.dispatch({ changes: { from: pos, insert: ch }, selection: { anchor: pos + ch.length } });
    at += 1;
    if (at >= text.length) stop();
  }, 26);
  view.contentDOM.addEventListener("keydown", stop);
  return stop;
}

/** The practice loop's guide (SPECs/onboarding-spec.md): one instruction at
 *  a time at the bottom of the real note, counting the steps, with a quiet
 *  Skip. It never leaves the flow: when the loop is done it offers Continue. */
export function PracticeGuide() {
  const id = useOnboardingStore((s) => s.sample);
  const path = useOnboardingStore((s) => s.practicePath);
  const body = useEditorStore((s) => (path ? (s.openFiles.get(path)?.content ?? "") : ""));
  const signedOut = useClaudeSignInStore((s) => s.account !== "signed-in");
  const [writing, setWriting] = useState<"no" | "yes" | "done">("no");
  const [time, setTime] = useState(0);
  const sample = id ? SAMPLES[id] : null;
  const step = sample ? stepOf(sample, body) : "done";

  // Open the episode or video at its moment, once its player is up.
  useEffect(() => {
    if (!path || sample?.start === undefined) return;
    seekVideo(path, sample.start);
    const tick = window.setInterval(() => {
      const t = videoPlayerFor(path)?.time();
      if (t !== undefined) setTime(t);
    }, 500);
    return () => window.clearInterval(tick);
  }, [path, sample?.start]);

  // Step 1 of a pin sample: a click on the note writes what stuck for them.
  useEffect(() => {
    if (!path || !sample?.suggest || step !== "capture" || writing !== "no") return;
    let cancel: (() => void) | null = null;
    const onDown = (event: MouseEvent) => {
      const dom = (event.target as Element | null)?.closest?.(".cm-editor");
      const view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null;
      // The same path can come in either Unicode form (the é in "Pensée").
      if (!view || editorPath(view)?.normalize("NFC") !== path.normalize("NFC")) return;
      document.removeEventListener("click", onDown, true);
      // A click (not mousedown): the caret is already placed, and typing keeps it.
      const at = emptyBullet(view);
      if (at === null) return;
      setWriting("yes");
      cancel = typeInto(view, at, sample.suggest!, () => setWriting("done"));
    };
    document.addEventListener("click", onDown, true);
    return () => {
      document.removeEventListener("click", onDown, true);
      cancel?.();
    };
  }, [path, sample?.suggest, step, writing]);

  if (!sample) return null;
  const total = sample.capture === "none" ? 2 : 3;
  const n = (s: Step) => (s === "capture" ? 1 : s === "pen" ? total - 1 : total);
  const pinKeys = (
    <>
      <Keys keys={PIN_SHORTCUT_LABEL.split("")} /> pins it to {formatVideoTime(time)}.
    </>
  );

  let message: ReactNode;
  if (step === "capture" && sample.capture === "pin") {
    message =
      writing === "yes" ? (
        "Pensée is writing what stuck…"
      ) : writing === "done" ? (
        <>Now {pinKeys}</>
      ) : (
        <>Click the line and Pensée writes what stuck. Then {pinKeys}</>
      );
  } else if (step === "capture") {
    message = "Select a line in the book, then choose Highlight. It lands in the note as a bullet.";
  } else if (step === "pen") {
    message = (
      <>
        Press <Keys keys={["⌘", "."]} /> on your line, then <kbd>{sample.pill}</kbd> for{" "}
        {sample.pillName}.
      </>
    );
  } else if (step === "take") {
    message = (
      <>
        Write your take, then <kbd>↵</kbd>. The answer opens after.
      </>
    );
  } else {
    message =
      sample.pill === "@"
        ? "That's Pensée: the evidence on both sides, and the call stays yours."
        : sample.pill === "[["
          ? "That's Pensée: your old notes, meeting your new line."
          : "That's Pensée: your take first, then its answer.";
  }

  return createPortal(
    <div className="onb-guide" role="status">
      {step !== "done" && (
        <span className="onb-guide-n">
          {n(step)} of {total}
        </span>
      )}
      <span className="onb-guide-msg">{message}</span>
      {step !== "capture" && step !== "done" && signedOut && (
        <span className="onb-guide-small">Needs Claude Code signed in</span>
      )}
      {step === "done" ? (
        <button type="button" className="onb-guide-go" onClick={() => goToScreen("more")}>
          Continue
        </button>
      ) : (
        <button type="button" className="onb-text-button" onClick={() => goToScreen("more")}>
          Skip
        </button>
      )}
    </div>,
    document.body,
  );
}
