import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cursor02Icon } from "@hugeicons/core-free-icons";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { TextReveal } from "@/components/arc/text-reveal/text-reveal";
import { markVideoUsed, seekVideo, videoPlayerFor } from "@/lib/video-players";
import { formatVideoTime } from "@/lib/video-pins";
import { lineAt, transcriptIn, transcriptLines, transcriptText } from "@/lib/video-transcript";
import { useAgentStore } from "@/stores/agent-store";
import { ensureArcTokens } from "./board/arc-tokens";
import "./transcript-box.css";

// The transcript toggle of a video note, shown as a teleprompter
// (SPECs/youtube-notes-spec.md#transcript-box): the line being said rises in
// as the video reaches it, earlier and later lines dim around it.

/** How often the box asks the player where it is. */
const TICK_MS = 250;
/** The line being said sits this far down the box, so a few earlier lines
 *  stay in view above it. */
const NOW_AT = 0.3;

interface TranscriptBoxProps {
  /** The `<details>` block's Markdown source. */
  source: string;
  /** The note the box sits in (read each time: a tab can swap notes). */
  notePath: () => string | null;
}

function TranscriptBox({ source, notePath }: TranscriptBoxProps) {
  const paragraphs = useMemo(() => transcriptIn(source), [source]);
  const lines = useMemo(() => transcriptLines(paragraphs), [paragraphs]);
  const clipboard = useMemo(() => transcriptText(paragraphs), [paragraphs]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState(() => {
    const path = notePath();
    const player = path ? videoPlayerFor(path) : null;
    return lineAt(lines, player?.time() ?? 0);
  });
  // Following: the list keeps the line being said in view. Scrolling it
  // yourself stops that until "Back to now" or a click on a line.
  const [following, setFollowing] = useState(true);

  // Ask the player only while the box is on screen.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let timer: number | null = null;
    const tick = () => {
      const path = notePath();
      const player = path ? videoPlayerFor(path) : null;
      if (player) setCurrent(lineAt(lines, player.time()));
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry!.isIntersecting && timer === null) {
        tick();
        timer = window.setInterval(tick, TICK_MS);
      } else if (!entry!.isIntersecting && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    });
    observer.observe(list);
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [lines, notePath]);

  useEffect(() => {
    const list = listRef.current;
    const line = list?.querySelector<HTMLElement>(`[data-line="${current}"]`);
    if (!following || !list || !line) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({
      top: line.offsetTop - list.clientHeight * NOW_AT,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [current, following]);

  const playFrom = (index: number) => {
    const path = notePath();
    const line = lines[index];
    if (!path || !line) return;
    // A drag that selected words is a copy, not a jump.
    if (!window.getSelection()?.isCollapsed) return;
    markVideoUsed(path);
    seekVideo(path, line.start);
    setCurrent(index);
    setFollowing(true);
  };

  // Only the user's own scrolling stops following; the box's smooth scroll
  // fires scroll events too, so listen for the inputs instead.
  const stopFollowing = () => setFollowing(false);

  return (
    <section className="transcript-box" aria-label="Transcript">
      <header className="transcript-box-head">
        <span className="transcript-box-title">Transcript</span>
        <div className="transcript-box-actions">
          {!following && (
            <button
              type="button"
              className="transcript-box-button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setFollowing(true)}
            >
              Back to now
            </button>
          )}
          <CopyButton value={clipboard} label="Copy" variant="plain" />
          <button
            type="button"
            className="transcript-box-button"
            title="Ask the Agent about this video (⌘J)"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => useAgentStore.getState().open()}
          >
            <HugeiconsIcon icon={Cursor02Icon} size={16} color="currentColor" strokeWidth={2} />
            Ask
          </button>
        </div>
      </header>
      <div
        ref={listRef}
        className="transcript-box-lines"
        onWheel={stopFollowing}
        onTouchMove={stopFollowing}
        onPointerDown={(event) => {
          // A press on the scrollbar itself, not on a line.
          if (event.target === event.currentTarget) stopFollowing();
        }}
      >
        {lines.map((line, index) => (
          <div
            key={index}
            data-line={index}
            data-state={index === current ? "now" : index < current ? "said" : "ahead"}
            className="transcript-box-line"
            onClick={() => playFrom(index)}
          >
            <span className="transcript-box-time">{formatVideoTime(line.start)}</span>
            {index === current ? (
              <TextReveal key={index} as="p" text={line.text} className="transcript-box-reveal" />
            ) : (
              <p>{line.text}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Renders the box into `host` (the transcript block's widget). Returns its unmount. */
export function mountTranscriptBox(host: HTMLElement, props: TranscriptBoxProps): () => void {
  ensureArcTokens();
  const root = createRoot(host);
  root.render(<TranscriptBox {...props} />);
  return () => root.unmount();
}
