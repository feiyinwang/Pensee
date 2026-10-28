import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ScrollText } from "lucide-react";

import { videoLinkOf } from "@/lib/video-pins";
import { transcriptSourceIn } from "@/lib/video-transcript";
import {
  type VideoPlayer as VideoPlayerHandle,
  armAutoPin,
  disarmAutoPin,
  markVideoUsed,
  registerVideoPlayer,
  setVideoHovered,
  videoPlayerOrigin,
} from "@/lib/video-players";
import { saveVideoSnapshot, youtubeChapters } from "@/lib/tauri";
import { ZOOM_SETTING_KEY, clampZoom } from "@/lib/zoom";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { showEditorNotice } from "./editor-notice-store";
import { PlayerKeys } from "./player-keys";
import {
  installVideoPinShortcut,
  returnFocusFrom,
  saveTheMoment,
  screenshotTheMoment,
} from "./video-pin";
import { useTranscriptView } from "./transcript-view";
import { bringInTranscript, captionLanguagesOf } from "./video-transcript";
import { isInHiddenTab } from "./hidden-tab";
import "./video-player.css";

// The box brings in Arc and `motion`: only notes with a transcript load it
// (docs/arc.md).
const TranscriptBox = lazy(() =>
  import("./transcript-box").then((module) => {
    module.prepareTranscriptBox();
    return { default: module.TranscriptBox };
  }),
);

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
  const link = useMemo(
    () =>
      frontmatter && /^(url|link|source)\s*:/im.test(frontmatter) ? videoLinkOf(frontmatter) : null,
    [frontmatter],
  );
  const videoId = link?.id ?? null;
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
  return (
    <VideoBand
      key={videoId}
      filePath={filePath}
      videoId={videoId}
      start={link?.start ?? 0}
      origin={origin}
    />
  );
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
    if (videoId && videoId !== seen.current.videoId) {
      // Only a video with captions: one without them gets no transcript and
      // no notice saying so.
      captionLanguagesOf(videoId).then(
        (languages) => {
          if (languages.length) void bringInTranscript(filePath, videoId);
        },
        (error: unknown) => console.warn("[video] Couldn't read the caption languages:", error),
      );
    }
    seen.current.videoId = videoId;
  }, [filePath, loading, videoId]);
}

/**
 * Whether YouTube says `videoId` has captions. False until it answers, and
 * when it can't be asked: **Transcript** is offered only for a transcript
 * known to exist.
 */
function useHasCaptions(videoId: string): boolean {
  const [has, setHas] = useState<{ videoId: string; has: boolean }>();
  useEffect(() => {
    let current = true;
    captionLanguagesOf(videoId).then(
      (languages) => {
        if (current) setHas({ videoId, has: languages.length > 0 });
      },
      (error: unknown) => console.warn("[video] Couldn't read the caption languages:", error),
    );
    return () => {
      current = false;
    };
  }, [videoId]);
  return has?.videoId === videoId && has.has;
}

/** YouTube's `PlayerState.PAUSED` and `ENDED`. */
const YT_PAUSED = 2;
const YT_ENDED = 0;

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

// Where each video was left, so it opens there next time, as on YouTube.
// Kept per video for the most recent ones; a video watched to its end
// starts over.
const POSITIONS_KEY = "writer.video-positions";
const KEPT_POSITIONS = 200;
/** How often a playing video's place is written down. */
const POSITION_SAVE_MS = 5000;

function readPositions(): Record<string, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? "{}") as unknown;
    return saved && typeof saved === "object" ? (saved as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function watchedPosition(videoId: string): number | null {
  const seconds = Number(readPositions()[videoId]);
  return seconds >= 1 ? seconds : null;
}

/** `null` forgets the video's place. */
function rememberPosition(videoId: string, seconds: number | null): void {
  const positions = readPositions();
  // Re-added last, so the oldest are the first dropped.
  delete positions[videoId];
  if (seconds !== null && seconds >= 1) positions[videoId] = Math.floor(seconds);
  const ids = Object.keys(positions);
  for (const id of ids.slice(0, Math.max(0, ids.length - KEPT_POSITIONS))) delete positions[id];
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
  } catch (error) {
    console.warn("[video] Couldn't save where the video was left:", error);
  }
}

// The video's height, dragged: one beside the transcript, one with the video
// alone (transcript hidden, or under it in a narrow pane), for every video. A
// per-viewer layout choice, like the speed.
type Layout = "beside" | "alone";
const HEIGHT_KEYS: Record<Layout, string> = {
  beside: "writer.video-height",
  alone: "writer.video-height-alone",
};
/** Below this the picture is too small to read a slide. */
const MIN_VIDEO_HEIGHT = 140;
/** The transcript's narrowest, beside the video, and the gap before it
 *  (video-player.css). */
const BESIDE_TRANSCRIPT_MIN = 320 + 8;
/** How far one arrow key moves the edge. */
const HEIGHT_STEP = 24;

function readHeight(layout: Layout): number | null {
  try {
    const saved = Number(localStorage.getItem(HEIGHT_KEYS[layout]));
    return saved >= MIN_VIDEO_HEIGHT ? saved : null;
  } catch {
    return null;
  }
}

function saveHeight(layout: Layout, height: number | null): void {
  try {
    if (height === null) localStorage.removeItem(HEIGHT_KEYS[layout]);
    else localStorage.setItem(HEIGHT_KEYS[layout], String(Math.round(height)));
  } catch (error) {
    console.warn("[video] Couldn't save the video's height:", error);
  }
}

/** The band's CSS for each layout's size (video-player.css). */
const SIZE_STYLE: Record<Layout, { variable: string; flag: string }> = {
  beside: { variable: "--video-height", flag: "sized" },
  alone: { variable: "--video-height-alone", flag: "sizedAlone" },
};

/**
 * The video's size from two handles: the edge under it (drag up or down)
 * and, beside the transcript, the divider between them (drag left or
 * right). The video stays 16:9, so both set its height: beside, a shorter
 * video is narrower and the transcript takes the width; alone, it is
 * narrower and centred. Each layout keeps its own size, so hiding the
 * transcript gives the video the pane's width until it is sized alone.
 * Arrow keys move the handles too; a double-click puts back the layout's
 * default. The size is written straight to the band while dragging and
 * kept on release.
 */
function useVideoHeight(bandRef: React.RefObject<HTMLDivElement | null>) {
  const [heights, setHeights] = useState(() => ({
    beside: readHeight("beside"),
    alone: readHeight("alone"),
  }));

  const apply = (band: HTMLElement, layout: Layout, value: number | null) => {
    const { variable, flag } = SIZE_STYLE[layout];
    if (value === null) {
      band.style.removeProperty(variable);
      delete band.dataset[flag];
    } else {
      band.style.setProperty(variable, `${value}px`);
      band.dataset[flag] = "";
    }
  };

  /** Which size the handles set now: the transcript on screen beside the
   *  video, or not. */
  const layoutOf = (band: HTMLElement): Layout =>
    band.querySelector(".video-band-transcript")?.checkVisibility() ? "beside" : "alone";

  /** The tallest the video can be: its 16:9 height at the width it has
   *  (beside, what the transcript leaves), and no more than 80% of the
   *  window, so notes keep a strip. */
  const tallest = (band: HTMLElement, layout: Layout) => {
    const main = band.querySelector<HTMLElement>(".video-band-main");
    const width = (main?.clientWidth ?? 0) - (layout === "beside" ? BESIDE_TRANSCRIPT_MIN : 0);
    return Math.max(MIN_VIDEO_HEIGHT, Math.min((width * 9) / 16, window.innerHeight * 0.8));
  };

  const clamp = (band: HTMLElement, layout: Layout, value: number) =>
    Math.min(tallest(band, layout), Math.max(MIN_VIDEO_HEIGHT, value));

  const commit = (layout: Layout, value: number | null) => {
    setHeights((now) => ({ ...now, [layout]: value }));
    saveHeight(layout, value);
  };

  /** A drag on the edge (`y`: px down is px taller) or the divider (`x`: px
   *  right is px wider, 9/16 of that taller). */
  const drag = (axis: "x" | "y") => (event: React.PointerEvent<HTMLDivElement>) => {
    const band = bandRef.current;
    const frame = band?.querySelector<HTMLElement>(".video-frame");
    if (!band || !frame || event.button !== 0) return;
    // A press, not a focus: the caret stays in the note.
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const layout = layoutOf(band);
    const start = axis === "y" ? event.clientY : event.clientX;
    // In CSS pixels; the pointer moves in screen pixels, which differ while
    // the pane is drawn scaled (the tab columns' pinch).
    const startHeight = frame.offsetHeight;
    const scale = frame.getBoundingClientRect().height / startHeight || 1;
    let next = startHeight;
    band.dataset.resizing = axis;
    const move = (moveEvent: PointerEvent) => {
      const moved = ((axis === "y" ? moveEvent.clientY : moveEvent.clientX) - start) / scale;
      next = clamp(band, layout, startHeight + (axis === "y" ? moved : (moved * 9) / 16));
      apply(band, layout, next);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      delete band.dataset.resizing;
      if (next !== startHeight) commit(layout, next);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const keys =
    (smaller: string, larger: string) => (event: React.KeyboardEvent<HTMLDivElement>) => {
      const band = bandRef.current;
      const frame = band?.querySelector<HTMLElement>(".video-frame");
      if (!band || !frame) return;
      const step = event.key === smaller ? -1 : event.key === larger ? 1 : 0;
      if (!step) return;
      event.preventDefault();
      const layout = layoutOf(band);
      commit(layout, clamp(band, layout, frame.offsetHeight + step * HEIGHT_STEP));
    };

  const onDoubleClick = () => {
    if (bandRef.current) commit(layoutOf(bandRef.current), null);
  };

  // React owns the sizes between drags; a drag writes them directly.
  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    apply(band, "beside", heights.beside);
    apply(band, "alone", heights.alone);
  }, [bandRef, heights]);

  return {
    edge: { onPointerDown: drag("y"), onKeyDown: keys("ArrowUp", "ArrowDown"), onDoubleClick },
    divider: {
      onPointerDown: drag("x"),
      onKeyDown: keys("ArrowLeft", "ArrowRight"),
      onDoubleClick,
    },
  };
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
  start,
  origin,
}: {
  filePath: string;
  videoId: string;
  /** The second the note's link starts at (`t=210`); read when the frame loads. */
  start: number;
  origin: string;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const resize = useVideoHeight(bandRef);
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [error, setError] = useState<number | null>(null);
  const [stuck, setStuck] = useState(false);
  // For the keys line (⌘S named Play or Pin); the page reports it with every state.
  const [playing, setPlaying] = useState(false);
  // Asked to play and not playing yet: YouTube's player loads, then buffers
  // (about 2s from opening the note), and a ring over the video says the
  // press was taken.
  const [starting, setStarting] = useState(false);
  const transcript = useEditorStore((s) =>
    transcriptSourceIn(s.openFiles.get(filePath)?.content ?? ""),
  );
  const transcribed = transcript !== null;
  const hasCaptions = useHasCaptions(videoId);
  // Beside the video when the pane is wide enough (video-player.css): the
  // note's own box hides while this one shows. Folded, it goes back under.
  const collapsed = useTranscriptView((s) => s.collapsed);
  const setCollapsed = useTranscriptView((s) => s.setCollapsed);
  const [reading, setReading] = useState(false);
  // Where the video was left wins over the link's own start.
  const [from] = useState(() => watchedPosition(videoId) ?? start);
  // Read once per video: the page takes them in its address, so a change
  // must not reload the frame.
  const [src] = useState(() => {
    const prefs = readPrefs();
    const query = new URLSearchParams({ v: videoId, rate: String(prefs.rate) });
    if (from) query.set("t", String(from));
    if (prefs.cc) query.set("cc", "1");
    return `${origin}/youtube-player.html?${query}`;
  });

  useEffect(() => {
    installVideoPinShortcut();
    let report: Report = { t: from, playing: false, at: performance.now() };
    // The place last written down, and when: a report that hasn't moved
    // (the page saying it's ready) writes nothing.
    let saved = { t: from, at: 0 };
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

    // The page hides its own controls for a screenshot and says when they
    // are off the screen.
    let bareDone: (() => void) | null = null;
    const hideControls = () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          console.warn("[video] The player page didn't hide its controls in time.");
          bareDone = null;
          resolve();
        }, 500);
        bareDone = () => {
          clearTimeout(timer);
          bareDone = null;
          resolve();
        };
        post({ cmd: "bare", on: true });
      });

    let startTimer = 0;
    const startPlaying = (on: boolean) => {
      clearTimeout(startTimer);
      setStarting(on);
      // A play YouTube never answers (offline) doesn't spin forever.
      if (on) startTimer = window.setTimeout(() => setStarting(false), 20_000);
    };

    const player: VideoPlayerHandle = {
      notePath: filePath,
      time: () => (report.playing ? report.t + (performance.now() - report.at) / 1000 : report.t),
      seek: (seconds) => {
        if (!report.playing) startPlaying(true);
        send({ cmd: "seek", t: seconds });
        report = { t: seconds, playing: true, at: performance.now() };
      },
      toggle: () => {
        markVideoUsed(filePath);
        startPlaying(!report.playing);
        send({ cmd: "toggle" });
      },
      playing: () => report.playing,
      speed: (step) => {
        markVideoUsed(filePath);
        send({ cmd: "speed", step });
      },
      skip: (seconds) => {
        markVideoUsed(filePath);
        send({ cmd: "skip", by: seconds });
      },
      picture: async () => {
        const frame = frameRef.current;
        if (!frame) throw new Error("the video isn't loaded");
        markVideoUsed(filePath);
        await hideControls();
        try {
          // The web view's points: CSS pixels times the page zoom.
          const zoom = clampZoom(useSettingsStore.getState().settings[ZOOM_SETTING_KEY]) / 100;
          const box = frame.getBoundingClientRect();
          const saved = await saveVideoSnapshot(filePath, {
            x: box.x * zoom,
            y: box.y * zoom,
            width: box.width * zoom,
            height: box.height * zoom,
          });
          return saved.relative_path;
        } finally {
          post({ cmd: "bare", on: false });
        }
      },
      rect: () => frameRef.current?.getBoundingClientRect() ?? new DOMRect(),
      shown: () => {
        const frame = frameRef.current;
        return (
          !!frame && frame.checkVisibility({ visibilityProperty: true }) && !isInHiddenTab(frame)
        );
      },
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
        over?: boolean;
        on?: boolean;
        shift?: boolean;
      };
      if (message?.source !== "pensee-yt") return;
      if (message.type === "error") {
        startPlaying(false);
        setError(Number(message.code) || 0);
        return;
      }
      // A press in the player is done: typing goes back where it was, never
      // to the player page.
      if (message.type === "release") {
        if (frameRef.current) returnFocusFrom(frameRef.current, filePath);
        return;
      }
      // ⌘S / ⌘⇧S pressed while focus was in the page (a press on the video,
      // before focus came back): the app's keys never saw them.
      if (message.type === "key") {
        if (message.shift) void screenshotTheMoment(player);
        else saveTheMoment(player);
        return;
      }
      if (message.type === "bare") {
        if (message.on) bareDone?.();
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
      // The pointer over the page (the frame swallows its own pointer
      // events): ← / → skip this video until it leaves.
      if (message.type === "hover") {
        setVideoHovered(player, message.over === true);
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
      if (message.state === YT_ENDED) rememberPosition(videoId, null);
      else if (
        Math.abs(t - saved.t) >= 1 &&
        (!playing || report.at - saved.at >= POSITION_SAVE_MS)
      ) {
        rememberPosition(videoId, t);
        saved = { t, at: report.at };
      }
      setPlaying(playing);
      // Playing, or settled without playing (paused, ended): the wait is over.
      if (playing || message.state === YT_PAUSED || message.state === YT_ENDED) startPlaying(false);
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
      // Closed while playing: up to the last moment, not the last save.
      if (ready && report.playing) rememberPosition(videoId, player.time());
      clearTimeout(startTimer);
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

  const notePath = useMemo(() => () => filePath, [filePath]);

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
      <div
        ref={bandRef}
        className="video-band"
        data-stuck={stuck || undefined}
        data-beside={(transcribed && !collapsed) || undefined}
        data-transcript-hidden={(transcribed && collapsed) || undefined}
      >
        <div className="video-band-main">
          <div className="video-frame">
            {error === null ? (
              <>
                <iframe
                  ref={frameRef}
                  src={src}
                  title="YouTube video"
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                />
                {starting && <div className="video-starting" aria-hidden />}
              </>
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
          {transcript !== null && !collapsed && (
            <div className="video-band-transcript">
              <div
                className="video-band-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Video width"
                title="Drag to resize · double-click to reset"
                tabIndex={0}
                {...resize.divider}
              />
              <Suspense fallback={null}>
                <TranscriptBox source={transcript} notePath={notePath} placement="beside" />
              </Suspense>
            </div>
          )}
          <div
            className="video-band-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Video height"
            title="Drag to resize · double-click to reset"
            tabIndex={0}
            {...resize.edge}
          />
        </div>
        {error === null && (
          <div className="video-band-row">
            {/* The keys stand in for Play and Pin buttons: ⌘S plays, then pins
                and pauses. The page's own bar sets the speed. */}
            <PlayerKeys playing={playing} video />
            {!transcribed && hasCaptions && (
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
            {/* Hidden (its ×, or its fold under the video): brought back
                from here, beside the video or under it. */}
            {transcribed && collapsed && (
              <button
                type="button"
                className="video-pin-button"
                title="Show transcript"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setCollapsed(false)}
              >
                <ScrollText size={13} aria-hidden />
                Transcript
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
