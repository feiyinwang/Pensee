import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MapPin, ScrollText } from "lucide-react";

import { videoIdOf } from "@/lib/video-pins";
import { hasTranscript } from "@/lib/video-transcript";
import {
  type VideoPlayer as VideoPlayerHandle,
  armAutoPin,
  disarmAutoPin,
  markVideoUsed,
  registerVideoPlayer,
  videoPlayerOrigin,
} from "@/lib/video-players";
import { youtubeChapters } from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";
import { showEditorNotice } from "./editor-notice-store";
import {
  PIN_SHORTCUT_LABEL,
  installVideoPinShortcut,
  pinMoment,
  returnFocusFrom,
} from "./video-pin";
import { bringInTranscript } from "./video-transcript";
import "./video-player.css";

/**
 * A note whose properties link to a YouTube video plays it here, under the
 * properties, sticky at the top of the note while the notes scroll beneath
 * (SPECs/youtube-notes-spec.md). With a board open over the note it becomes a
 * mini player over the board (CSS only: the frame is never moved, so the
 * video never reloads).
 */
export function VideoPlayer({ filePath }: { filePath: string }) {
  const frontmatter = useEditorStore((s) => s.openFiles.get(filePath)?.frontmatter ?? null);
  // Most notes link no video: skip the YAML parse unless a link key is there.
  const videoId = useMemo(
    () =>
      frontmatter && /^(url|link|source)\s*:/im.test(frontmatter) ? videoIdOf(frontmatter) : null,
    [frontmatter],
  );
  useTranscriptForNewLinks(filePath, videoId);
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    if (!videoId) return;
    let current = true;
    videoPlayerOrigin().then(
      (value) => {
        if (current) setOrigin(value);
      },
      (error: unknown) => {
        console.error("[video] Couldn't start the player page:", error);
        showEditorNotice("Couldn't start the video player.");
      },
    );
    return () => {
      current = false;
    };
  }, [videoId]);

  if (!videoId || !origin) return null;
  return <VideoBand key={videoId} filePath={filePath} videoId={videoId} origin={origin} />;
}

/**
 * A link that turns up while the note is open (typed or pasted into its
 * properties, or changed to another video) brings that video's transcript
 * in. The link a note opens with is not new: opening an older video note
 * never rewrites it.
 */
function useTranscriptForNewLinks(filePath: string, videoId: string | null): void {
  const loading = useEditorStore((s) => s.openFiles.get(filePath)?.isLoading ?? true);
  const seen = useRef<{ filePath: string; videoId: string | null } | null>(null);
  useEffect(() => {
    if (loading) return;
    if (seen.current?.filePath !== filePath) {
      seen.current = { filePath, videoId };
      return;
    }
    if (videoId && videoId !== seen.current.videoId) void bringInTranscript(filePath, videoId);
    seen.current.videoId = videoId;
  }, [filePath, loading, videoId]);
}

/** YouTube's `PlayerState.PAUSED`. */
const YT_PAUSED = 2;

/** Each video's chapters, read once per launch (a watch page is ~1.5 MB;
 *  switching tabs remounts the player). A failed read is forgotten. */
const chapterReads = new Map<string, Promise<{ start: number; title: string }[]>>();

function chaptersOf(videoId: string): Promise<{ start: number; title: string }[]> {
  let read = chapterReads.get(videoId);
  if (!read) {
    read = youtubeChapters(videoId);
    read.catch(() => chapterReads.delete(videoId));
    chapterReads.set(videoId, read);
  }
  return read;
}

// Speed and subtitles carry over between videos and launches. Kept here,
// not in the player page, whose loopback origin changes every launch.
const PREFS_KEY = "writer.video-player";

interface Prefs {
  rate: number;
  cc: boolean;
}

function readPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return { rate: Number(saved.rate) || 1, cc: saved.cc === true };
  } catch {
    return { rate: 1, cc: false };
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.warn("[video] Couldn't save the player's speed and subtitles:", error);
  }
}

/** What the player page last said, and when, so the time can be read
 *  between its half-second reports. */
interface Report {
  t: number;
  playing: boolean;
  at: number;
}

function VideoBand({
  filePath,
  videoId,
  origin,
}: {
  filePath: string;
  videoId: string;
  origin: string;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [error, setError] = useState<number | null>(null);
  const [stuck, setStuck] = useState(false);
  const transcribed = useEditorStore((s) =>
    hasTranscript(s.openFiles.get(filePath)?.content ?? ""),
  );
  const [reading, setReading] = useState(false);
  // Read once per video: the page takes them in its address, so a change
  // must not reload the frame.
  const [src] = useState(() => {
    const prefs = readPrefs();
    const query = new URLSearchParams({ v: videoId, rate: String(prefs.rate) });
    if (prefs.cc) query.set("cc", "1");
    return `${origin}/youtube-player.html?${query}`;
  });

  useEffect(() => {
    installVideoPinShortcut();
    let report: Report = { t: 0, playing: false, at: performance.now() };
    // Commands sent before the page has loaded would be dropped: the last
    // one waits for its first report.
    let ready = false;
    let waiting: Record<string, unknown> | null = null;
    const post = (command: Record<string, unknown>) =>
      frameRef.current?.contentWindow?.postMessage({ source: "pensee", ...command }, origin);
    const send = (command: Record<string, unknown>) => {
      if (!ready) {
        waiting = command;
        return;
      }
      post(command);
    };
    // The chapters come from YouTube's watch page; they go to the page once
    // both it and they are there.
    let chapters: { start: number; title: string }[] | null = null;
    let disposed = false;
    chaptersOf(videoId).then(
      (list) => {
        if (disposed) return;
        chapters = list;
        if (ready) post({ cmd: "chapters", chapters });
      },
      (reason: unknown) => console.warn("[video] Couldn't read the video's chapters:", reason),
    );

    const player: VideoPlayerHandle = {
      notePath: filePath,
      time: () => (report.playing ? report.t + (performance.now() - report.at) / 1000 : report.t),
      seek: (seconds) => {
        send({ cmd: "seek", t: seconds });
        report = { t: seconds, playing: true, at: performance.now() };
      },
      toggle: () => {
        markVideoUsed(filePath);
        send({ cmd: "toggle" });
      },
      speed: (step) => {
        markVideoUsed(filePath);
        send({ cmd: "speed", step });
      },
      rect: () => frameRef.current?.getBoundingClientRect() ?? new DOMRect(),
      shown: () => frameRef.current?.checkVisibility({ visibilityProperty: true }) ?? false,
    };
    playerRef.current = player;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frameRef.current?.contentWindow) return;
      const message = event.data as {
        source?: string;
        type?: string;
        t?: number;
        playing?: boolean;
        state?: number;
        code?: number;
        rate?: number;
        cc?: boolean;
        deltaX?: number;
        deltaY?: number;
        ctrlKey?: boolean;
      };
      if (message?.source !== "pensee-yt") return;
      if (message.type === "error") {
        setError(Number(message.code) || 0);
        return;
      }
      // A press in the player is done: typing goes back where it was, never
      // to the player page.
      if (message.type === "release") {
        if (frameRef.current) returnFocusFrom(frameRef.current);
        return;
      }
      if (message.type === "prefs") {
        savePrefs({ rate: Number(message.rate) || 1, cc: message.cc === true });
        return;
      }
      if (message.type === "wheel") {
        forwardWheel(message.deltaX ?? 0, message.deltaY ?? 0, message.ctrlKey === true);
        return;
      }
      if (message.type !== "state") return;
      if (!ready) {
        ready = true;
        if (waiting) send(waiting);
        waiting = null;
        if (chapters) post({ cmd: "chapters", chapters });
      }
      const playing = Boolean(message.playing);
      const t = Number(message.t) || 0;
      // Paused (not buffering or ended): words typed next pin this moment.
      if (report.playing && message.state === YT_PAUSED) armAutoPin(filePath, t);
      if (playing) {
        markVideoUsed(filePath);
        disarmAutoPin();
      }
      report = { t, playing, at: performance.now() };
    };
    // A scroll or pinch over the video happens in the page's frame, out of
    // the note's reach: the page sends it here. A scroll moves the note; a
    // pinch goes on as a wheel event from the frame, so the tab columns'
    // pinch sees it like any other. Over a board (mini player) it does
    // nothing.
    const forwardWheel = (deltaX: number, deltaY: number, ctrlKey: boolean) => {
      const frame = frameRef.current;
      if (!frame || frame.closest("[data-pane]")?.querySelector(":scope > .wr-board-inline")) {
        return;
      }
      if (ctrlKey) {
        frame.dispatchEvent(
          new WheelEvent("wheel", { deltaX, deltaY, ctrlKey, bubbles: true, cancelable: true }),
        );
      } else {
        sentinelRef.current?.parentElement?.scrollBy({ left: deltaX, top: deltaY });
      }
    };

    window.addEventListener("message", onMessage);
    const unregister = registerVideoPlayer(player);
    return () => {
      disposed = true;
      window.removeEventListener("message", onMessage);
      unregister();
      playerRef.current = null;
    };
  }, [filePath, origin, videoId]);

  // Stuck once the properties above have scrolled away: only then does the
  // band need a backdrop of its own.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scroller = sentinel?.parentElement;
    if (!sentinel || !scroller) return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry!.isIntersecting), {
      root: scroller,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const openOnYouTube = () => {
    openUrl(watchUrl).catch((reason: unknown) => {
      console.error("[video] Couldn't open YouTube:", reason);
      showEditorNotice("Couldn't open the video on YouTube.");
    });
  };

  return (
    <>
      <div ref={sentinelRef} className="video-band-sentinel" aria-hidden />
      <div className="video-band" data-stuck={stuck || undefined}>
        <div className="video-frame">
          {error === null ? (
            <iframe
              ref={frameRef}
              src={src}
              title="YouTube video"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          ) : (
            <div className="video-error">
              <p>
                {error === 100
                  ? "This video is private or was removed."
                  : "This video can't play inside Pensée."}
              </p>
              <button type="button" onClick={openOnYouTube}>
                Open on YouTube
              </button>
            </div>
          )}
        </div>
        {error === null && (
          <div className="video-band-row">
            {!transcribed && (
              <button
                type="button"
                className="video-pin-button"
                disabled={reading}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setReading(true);
                  void bringInTranscript(filePath, videoId).finally(() => setReading(false));
                }}
              >
                <ScrollText size={13} aria-hidden />
                {reading ? "Getting transcript…" : "Transcript"}
              </button>
            )}
            <button
              type="button"
              className="video-pin-button"
              // Focus stays in the note or board, where the pin goes.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pinMoment(playerRef.current ?? undefined)}
            >
              <MapPin size={13} aria-hidden />
              Pin
              <kbd>{PIN_SHORTCUT_LABEL}</kbd>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
