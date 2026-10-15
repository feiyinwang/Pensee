import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MapPin, Pause, Play } from "lucide-react";

import {
  formatSpeed,
  nextPodcastPreset,
  podcastLinkOf,
  stepPodcastSpeed,
} from "@/lib/podcast-player";
import { podcastAudio } from "@/lib/tauri";
import { formatVideoTime } from "@/lib/video-pins";
import {
  type VideoPlayer as PlayerHandle,
  armAutoPin,
  disarmAutoPin,
  markVideoUsed,
  registerVideoPlayer,
} from "@/lib/video-players";
import { useEditorStore } from "@/stores/editor-store";
import { showEditorNotice } from "./editor-notice-store";
import { PIN_SHORTCUT_LABEL, installVideoPinShortcut, pinMoment } from "./video-pin";
import "./video-player.css";
import "./podcast-player.css";

/**
 * A podcast note plays its episode here, under the properties, sticky at the
 * top of the note like a YouTube note's player (SPECs/podcast-notes-spec.md).
 * It joins the same player registry, so ⌘⇧J, ⌘⇧M, `<` / `>` and pins work
 * the same.
 */
export function PodcastPlayer({ filePath }: { filePath: string }) {
  const frontmatter = useEditorStore((s) => s.openFiles.get(filePath)?.frontmatter ?? null);
  // Most notes link nothing: skip the YAML parse unless a link key is there.
  const link = useMemo(
    () =>
      frontmatter && /^(url|link|source)\s*:/im.test(frontmatter)
        ? podcastLinkOf(frontmatter)
        : null,
    [frontmatter],
  );
  if (!link) return null;
  return <PodcastBand key={link} filePath={filePath} link={link} />;
}

/** Each link's audio, found once per launch (a Spotify link takes a few
 *  requests). A failed find is forgotten, so reopening the note tries again. */
const audioFinds = new Map<string, Promise<string>>();

function findAudio(link: string): Promise<string> {
  let find = audioFinds.get(link);
  if (!find) {
    find = podcastAudio(link);
    find.catch(() => audioFinds.delete(link));
    audioFinds.set(link, find);
  }
  return find;
}

// The speed carries over between episodes and launches.
const PREFS_KEY = "writer.podcast-player";

function readRate(): number {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { rate?: unknown };
    return Number(saved.rate) || 1;
  } catch {
    return 1;
  }
}

function saveRate(rate: number): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ rate }));
  } catch (error) {
    console.warn("[podcast] Couldn't save the player's speed:", error);
  }
}

type Found = { audio: string } | { error: string } | null;

function PodcastBand({ filePath, link }: { filePath: string; link: string }) {
  const bandRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const [found, setFound] = useState<Found>(null);
  const [stuck, setStuck] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(readRate);

  useEffect(() => {
    let current = true;
    findAudio(link).then(
      (audio) => current && setFound({ audio }),
      (reason: unknown) => {
        console.error(`[podcast] Couldn't find the audio of ${link}:`, reason);
        const message = String(reason);
        // Offline, or the page refused: the backend's wording is not for the user.
        const shown = /^(Network error|Invalid URL)/.test(message)
          ? "Couldn't reach the episode's page."
          : message;
        if (current) setFound({ error: shown });
      },
    );
    return () => {
      current = false;
    };
  }, [link]);

  // The player is there from the start, so ⌘⇧J or a pin pressed while the
  // episode is still being found plays it once it is.
  useEffect(() => {
    installVideoPinShortcut();
    let pending: { play: boolean; at: number | null } = { play: false, at: null };
    const element = () => {
      const audio = audioRef.current;
      return audio && audio.readyState >= HTMLMediaElement.HAVE_METADATA ? audio : null;
    };
    const play = (audio: HTMLAudioElement) => {
      audio.play().catch((reason: unknown) => {
        console.error("[podcast] Couldn't play:", reason);
        showEditorNotice("Couldn't play this episode.");
      });
    };
    const player: PlayerHandle = {
      notePath: filePath,
      time: () => element()?.currentTime ?? pending.at ?? 0,
      seek: (seconds) => {
        const audio = element();
        if (!audio) {
          pending = { play: true, at: seconds };
          return;
        }
        audio.currentTime = seconds;
        play(audio);
      },
      toggle: () => {
        markVideoUsed(filePath);
        const audio = element();
        if (!audio) {
          pending = { ...pending, play: !pending.play };
          return;
        }
        if (audio.paused) play(audio);
        else audio.pause();
      },
      speed: (step) => {
        markVideoUsed(filePath);
        setRate((value) => stepPodcastSpeed(value, step));
      },
      rect: () => bandRef.current?.getBoundingClientRect() ?? new DOMRect(),
      shown: () => bandRef.current?.checkVisibility({ visibilityProperty: true }) ?? false,
    };
    playerRef.current = player;

    // Whatever was asked for before the audio could play.
    const onReady = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (pending.at !== null) audio.currentTime = pending.at;
      if (pending.play) play(audio);
      pending = { play: false, at: null };
    };
    const audio = audioRef.current;
    audio?.addEventListener("loadedmetadata", onReady);
    const unregister = registerVideoPlayer(player);
    return () => {
      audio?.removeEventListener("loadedmetadata", onReady);
      unregister();
      playerRef.current = null;
    };
  }, [filePath]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
    saveRate(rate);
  }, [rate]);

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

  const openLink = () => {
    openUrl(link).catch((reason: unknown) => {
      console.error("[podcast] Couldn't open the link:", reason);
      showEditorNotice("Couldn't open the episode's page.");
    });
  };

  const audioSrc = found && "audio" in found ? found.audio : undefined;
  const error = found && "error" in found ? found.error : null;
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <>
      <div ref={sentinelRef} className="video-band-sentinel" aria-hidden />
      <div ref={bandRef} className="video-band podcast-band" data-stuck={stuck || undefined}>
        {/* Always mounted, so the player's listeners hold from the start. */}
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="metadata"
          onPlay={() => {
            setPlaying(true);
            markVideoUsed(filePath);
            disarmAutoPin();
          }}
          onPause={(event) => {
            setPlaying(false);
            // Paused (not ended): words typed next pin this moment.
            if (!event.currentTarget.ended) armAutoPin(filePath, event.currentTarget.currentTime);
          }}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
          onLoadedMetadata={(event) => {
            event.currentTarget.playbackRate = rate;
          }}
          onError={() => setFound({ error: "This episode's audio wouldn't load." })}
        />
        <div className="podcast-column">
          <div className="podcast-bar">
            {error !== null ? (
              <>
                <p className="podcast-message">{error}</p>
                <button type="button" className="video-pin-button" onClick={openLink}>
                  Open link
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="podcast-play"
                  aria-label={playing ? "Pause" : "Play"}
                  title={playing ? "Pause (⌘⇧J)" : "Play (⌘⇧J)"}
                  disabled={!audioSrc}
                  // Focus stays in the note, where typing and pins go.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => playerRef.current?.toggle()}
                >
                  {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                </button>
                {audioSrc ? (
                  <>
                    <span className="podcast-time">{formatVideoTime(time)}</span>
                    <input
                      type="range"
                      className="podcast-track"
                      aria-label="Position"
                      min={0}
                      max={duration || 0}
                      step={1}
                      value={Math.min(time, duration || 0)}
                      disabled={!duration}
                      style={{ "--progress": `${progress * 100}%` } as CSSProperties}
                      onChange={(event) => {
                        const audio = audioRef.current;
                        if (!audio) return;
                        audio.currentTime = Number(event.currentTarget.value);
                        setTime(audio.currentTime);
                      }}
                      onPointerUp={(event) => event.currentTarget.blur()}
                    />
                    <span className="podcast-time">
                      {duration ? formatVideoTime(duration) : "–:––"}
                    </span>
                  </>
                ) : (
                  <p className="podcast-message">Finding the episode…</p>
                )}
                <button
                  type="button"
                  className="video-pin-button podcast-speed"
                  title="Speed (< / >)"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setRate((value) => nextPodcastPreset(value))}
                >
                  {formatSpeed(rate)}
                </button>
                <button
                  type="button"
                  className="video-pin-button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pinMoment(playerRef.current ?? undefined)}
                >
                  <MapPin size={13} aria-hidden />
                  Pin
                  <kbd>{PIN_SHORTCUT_LABEL}</kbd>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
