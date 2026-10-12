import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MapPin } from "lucide-react";

import { videoIdOf } from "@/lib/video-pins";
import {
  type VideoPlayer as VideoPlayerHandle,
  markVideoUsed,
  registerVideoPlayer,
  videoPlayerOrigin,
} from "@/lib/video-players";
import { useEditorStore } from "@/stores/editor-store";
import { showEditorNotice } from "./editor-notice-store";
import {
  PIN_SHORTCUT_LABEL,
  installVideoPinShortcut,
  pinMoment,
  returnFocusFrom,
} from "./video-pin";
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

  useEffect(() => {
    installVideoPinShortcut();
    let report: Report = { t: 0, playing: false, at: performance.now() };
    // Commands sent before the page has loaded would be dropped: the last
    // one waits for its first report.
    let ready = false;
    let waiting: Record<string, unknown> | null = null;
    const send = (command: Record<string, unknown>) => {
      if (!ready) {
        waiting = command;
        return;
      }
      frameRef.current?.contentWindow?.postMessage({ source: "writer", ...command }, origin);
    };

    const player: VideoPlayerHandle = {
      notePath: filePath,
      time: () => (report.playing ? report.t + (performance.now() - report.at) / 1000 : report.t),
      seek: (seconds) => {
        send({ cmd: "seek", t: seconds });
        report = { t: seconds, playing: true, at: performance.now() };
      },
      rect: () => frameRef.current?.getBoundingClientRect() ?? new DOMRect(),
    };
    playerRef.current = player;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frameRef.current?.contentWindow) return;
      const message = event.data as {
        source?: string;
        type?: string;
        t?: number;
        playing?: boolean;
        code?: number;
      };
      if (message?.source !== "writer-yt") return;
      if (message.type === "error") {
        setError(Number(message.code) || 0);
        return;
      }
      if (message.type !== "state") return;
      if (!ready) {
        ready = true;
        if (waiting) send(waiting);
        waiting = null;
      }
      const playing = Boolean(message.playing);
      const toggled = playing !== report.playing;
      report = { t: Number(message.t) || 0, playing, at: performance.now() };
      if (playing) markVideoUsed(filePath);
      // Played or paused by a click in the player: typing goes back where it
      // was, never to YouTube's keys. Only on the change, so a menu opened in
      // the player while it plays keeps focus.
      if (toggled && frameRef.current) returnFocusFrom(frameRef.current);
    };
    window.addEventListener("message", onMessage);
    const unregister = registerVideoPlayer(player);
    return () => {
      window.removeEventListener("message", onMessage);
      unregister();
      playerRef.current = null;
    };
  }, [filePath, origin]);

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
        <div className="video-band-inner">
          <div className="video-band-player">
            <div className="video-frame">
              {error === null ? (
                <iframe
                  ref={frameRef}
                  src={`${origin}/youtube-player.html?v=${encodeURIComponent(videoId)}`}
                  title="YouTube video"
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              ) : (
                <div className="video-error">
                  <p>
                    {error === 100
                      ? "This video is private or was removed."
                      : "This video can't play inside Writer."}
                  </p>
                  <button type="button" onClick={openOnYouTube}>
                    Open on YouTube
                  </button>
                </div>
              )}
            </div>
            {error === null && (
              <div className="video-band-row">
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
        </div>
      </div>
    </>
  );
}
