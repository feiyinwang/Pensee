import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cursor02Icon } from "@hugeicons/core-free-icons";
import { ChevronDown } from "lucide-react";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { DropdownMenu } from "@/components/arc/dropdown-menu/dropdown-menu";
import { markVideoUsed, seekVideo, videoPlayerFor } from "@/lib/video-players";
import { formatVideoTime, videoIdOf } from "@/lib/video-pins";
import {
  lineAt,
  transcriptIn,
  transcriptLanguageIn,
  transcriptLines,
  transcriptText,
} from "@/lib/video-transcript";
import { useAgentStore } from "@/stores/agent-store";
import { useEditorStore } from "@/stores/editor-store";
import { ensureArcTokens } from "./board/arc-tokens";
import { useTranscriptView } from "./transcript-view";
import { captionLanguagesOf, changeTranscriptLanguage } from "./video-transcript";
import "./transcript-box.css";

// The transcript toggle of a video note, shown as a teleprompter
// (SPECs/youtube-notes-spec.md#transcript-box): the line being said is
// highlighted as the video reaches it, earlier and later lines dim around it.
// It sits in the note under the video, or beside the video, pinned with it,
// when the pane is wide enough (video-player.tsx).

/** How often the box asks the player where it is. */
const TICK_MS = 250;
/** The line being said sits this far down the box, so a few earlier lines
 *  stay in view above it. */
const NOW_AT = 0.3;

export interface TranscriptBoxProps {
  /** The `<details>` block's Markdown source. */
  source: string;
  /** The note the box sits in (read each time: a tab can swap notes). */
  notePath: () => string | null;
  /** In the note under the video, or beside it in the video's band (where
   *  the box fills the video's height). */
  placement: "note" | "beside";
}

/** "English (auto-generated)" → "English": the menu's button stays short. */
function shortLanguageName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "") || name;
}

/** The caption languages of the box's video, once read; empty while
 *  reading, on a failed read, or for a note that links no video. */
function useCaptionLanguages(notePath: () => string | null): {
  videoId: string | null;
  languages: { code: string; name: string }[];
} {
  const path = notePath();
  // Select the frontmatter string, not the id: the store changes on every
  // keystroke, and the YAML parse should run only when the properties do.
  const frontmatter = useEditorStore((s) =>
    path ? (s.openFiles.get(path)?.frontmatter ?? null) : null,
  );
  const videoId = useMemo(() => videoIdOf(frontmatter), [frontmatter]);
  const [read, setRead] = useState<{
    videoId: string;
    languages: { code: string; name: string }[];
  }>();
  useEffect(() => {
    if (!videoId) return;
    let current = true;
    captionLanguagesOf(videoId).then(
      (languages) => {
        if (current) setRead({ videoId, languages });
      },
      (error: unknown) => console.warn("[video] Couldn't read the caption languages:", error),
    );
    return () => {
      current = false;
    };
  }, [videoId]);
  return { videoId, languages: read?.videoId === videoId ? read.languages : [] };
}

export function TranscriptBox({ source, notePath, placement }: TranscriptBoxProps) {
  const paragraphs = useMemo(() => transcriptIn(source), [source]);
  const language = useMemo(() => transcriptLanguageIn(source), [source]);
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
  const collapsed = useTranscriptView((s) => s.collapsed);
  const setCollapsed = useTranscriptView((s) => s.setCollapsed);
  const { videoId, languages } = useCaptionLanguages(notePath);
  // The language being read, until the new transcript replaces this box.
  const [reading, setReading] = useState<string | null>(null);

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
    if (!following || collapsed || !list || !line) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({
      top: line.offsetTop - list.clientHeight * NOW_AT,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [current, following, collapsed]);

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

  const readIn = (code: string, name: string) => {
    const path = notePath();
    if (!path || !videoId || code === language) return;
    setReading(name);
    void changeTranscriptLanguage(path, videoId, code).finally(() => setReading(null));
  };
  const compact = placement === "beside";
  const currentLanguage = languages.find((option) => option.code === language);
  const languageLabel = reading
    ? `${shortLanguageName(reading)}…`
    : currentLanguage
      ? shortLanguageName(currentLanguage.name)
      : "Language";

  return (
    <section
      className="transcript-box"
      aria-label="Transcript"
      data-placement={placement}
      data-collapsed={collapsed || undefined}
    >
      <header className="transcript-box-head">
        <div className="transcript-box-lead">
          <button
            type="button"
            className="transcript-box-fold"
            aria-expanded={!collapsed}
            title={collapsed ? "Show transcript" : "Hide transcript"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronDown size={14} aria-hidden className="transcript-box-chevron" />
            <span className="transcript-box-title">Transcript</span>
          </button>
          {/* Only a video with captions in more than one language has a choice. */}
          {languages.length > 1 && (
            <DropdownMenu
              label={languageLabel}
              align="start"
              items={languages.map((option) => ({
                label: option.name,
                disabled: reading !== null,
                onSelect: () => readIn(option.code, option.name),
              }))}
            />
          )}
        </div>
        <div className="transcript-box-actions">
          {!following && !collapsed && (
            <button
              type="button"
              className="transcript-box-button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setFollowing(true)}
            >
              Back to now
            </button>
          )}
          {/* Beside the video the header is about 330px wide: icons only. */}
          <CopyButton value={clipboard} label="Copy" variant="plain" iconOnly={compact} />
          <button
            type="button"
            className="transcript-box-button"
            title="Ask the Agent about this video (⌘J)"
            aria-label="Ask"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => useAgentStore.getState().open()}
          >
            <HugeiconsIcon icon={Cursor02Icon} size={16} color="currentColor" strokeWidth={2} />
            {!compact && "Ask"}
          </button>
        </div>
      </header>
      <div className="transcript-box-body" inert={collapsed}>
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
              <p>{line.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Loads what the box's Arc parts need; call before rendering it. */
export { ensureArcTokens as prepareTranscriptBox };

/** Renders the box into `host` (the transcript block's widget). Returns its unmount. */
export function mountTranscriptBox(host: HTMLElement, props: TranscriptBoxProps): () => void {
  ensureArcTokens();
  const root = createRoot(host);
  root.render(<TranscriptBox {...props} />);
  return () => root.unmount();
}
