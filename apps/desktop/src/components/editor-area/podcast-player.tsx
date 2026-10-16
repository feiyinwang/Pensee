import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Mic, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";

import { pageProperty } from "@/lib/book-highlights";
import { getFileStem } from "@/lib/paths";
import {
  SKIP_AHEAD_SECONDS,
  SKIP_BACK_SECONDS,
  formatSpeed,
  nextPodcastPreset,
  podcastLinkOf,
  podcastSourceLabel,
  stepPodcastSpeed,
} from "@/lib/podcast-player";
import { type PodcastEpisode, podcastEpisode } from "@/lib/tauri";
import { formatVideoTime } from "@/lib/video-pins";
import {
  type VideoPlayer as PlayerHandle,
  armAutoPin,
  disarmAutoPin,
  markVideoUsed,
  registerVideoPlayer,
} from "@/lib/video-players";
import { useEditorStore } from "@/stores/editor-store";
import { useChromeTooltip } from "../chrome-tooltip";
import { coverValueSrc } from "../spaces/space-cover";
import { showEditorNotice } from "./editor-notice-store";
import { PlayerKeys } from "./player-keys";
import { SPEED_KEYSHORTCUTS, installVideoPinShortcut } from "./video-pin";
import "./video-player.css";
import "./podcast-player.css";

/**
 * A podcast note plays its episode here, under the properties, sticky at the
 * top of the note like a YouTube note's player (SPECs/podcast-notes-spec.md).
 * It joins the same player registry, so ⌘S, `<` / `>` and pins work
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
  // The note's own `Cover:` wins over the episode's artwork.
  const cover = useMemo(
    () =>
      link && /^cover\s*:/im.test(frontmatter ?? "")
        ? coverValueSrc(filePath, pageProperty(frontmatter, "cover") ?? undefined, "podcast")
        : null,
    [link, frontmatter, filePath],
  );
  if (!link) return null;
  return <PodcastBand key={link} filePath={filePath} link={link} cover={cover} />;
}

/** Each link's episode, found once per launch (a Spotify link takes a few
 *  requests). A failed find is forgotten, so reopening the note tries again. */
const episodeFinds = new Map<string, Promise<PodcastEpisode>>();

function findEpisode(link: string): Promise<PodcastEpisode> {
  let find = episodeFinds.get(link);
  if (!find) {
    find = podcastEpisode(link);
    find.catch(() => episodeFinds.delete(link));
    episodeFinds.set(link, find);
  }
  return find;
}

// The speed and volume carry over between episodes and launches.
const PREFS_KEY = "writer.podcast-player";

interface Prefs {
  rate: number;
  volume: number;
}

function readPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    const volume = Number(saved.volume);
    return {
      rate: Number(saved.rate) || 1,
      volume: Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 1,
    };
  } catch {
    return { rate: 1, volume: 1 };
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.warn("[podcast] Couldn't save the player's speed and volume:", error);
  }
}

/** The episode once found, or why it couldn't be reached at all. */
type Found = { episode: PodcastEpisode } | { error: string } | null;

/** Clicking the card's buttons leaves focus in the note, where typing and
 *  pins go. */
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

function PodcastBand({
  filePath,
  link,
  cover,
}: {
  filePath: string;
  link: string;
  cover: string | null;
}) {
  const bandRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const [found, setFound] = useState<Found>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [prefs, setPrefs] = useState(readPrefs);
  // The volume to go back to when unmuted.
  const [unmuted, setUnmuted] = useState(() => prefs.volume || 1);
  // The webview never shows a native `title`, so the play button's
  // shortcut needs a tooltip of its own.
  // ⌘S plays on while paused; while playing it pins the moment and pauses.
  const playTip = useChromeTooltip(playing ? "Pause" : "Play", {
    keys: playing ? [] : ["⌘", "S"],
  });

  useEffect(() => {
    let current = true;
    findEpisode(link).then(
      (episode) => current && setFound({ episode }),
      (reason: unknown) => {
        console.error(`[podcast] Couldn't find the episode of ${link}:`, reason);
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

  // The player is there from the start, so ⌘S or a pin pressed while the
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
      playing: () => {
        const audio = element();
        return audio ? !audio.paused : pending.play;
      },
      speed: (step) => {
        markVideoUsed(filePath);
        setPrefs((value) => ({ ...value, rate: stepPodcastSpeed(value.rate, step) }));
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
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = prefs.rate;
      audio.volume = prefs.volume;
    }
    savePrefs(prefs);
  }, [prefs]);

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

  const skip = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + seconds));
    setTime(audio.currentTime);
  };

  const setVolume = (volume: number) => {
    if (volume > 0) setUnmuted(volume);
    setPrefs((value) => ({ ...value, volume }));
  };

  const episode = found && "episode" in found ? found.episode : null;
  const audioSrc = episode?.audio ?? undefined;
  const problem = loadFailed
    ? "This episode's audio wouldn't load."
    : found && "error" in found
      ? found.error
      : (episode?.problem ?? null);
  const ready = Boolean(audioSrc) && duration > 0;
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;
  const title = episode?.title ?? getFileStem(filePath);
  const show = episode?.show ?? podcastSourceLabel(link);
  const muted = prefs.volume === 0;

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
            event.currentTarget.playbackRate = prefs.rate;
            event.currentTarget.volume = prefs.volume;
          }}
          onError={() => setLoadFailed(true)}
        />
        <div className="podcast-column">
          <section className="podcast-card" aria-label="Podcast player">
            <PodcastArtwork sources={[cover, episode?.artwork ?? null]} />
            <div className="podcast-main">
              <div className="podcast-now">
                <div className="podcast-heading">
                  <p className="podcast-title" title={title}>
                    {title}
                  </p>
                  <p className="podcast-show" title={show}>
                    {show}
                  </p>
                </div>
                {problem === null && (
                  <div className="podcast-transport">
                    <button
                      type="button"
                      className="podcast-skip"
                      aria-label={`Back ${SKIP_BACK_SECONDS} seconds`}
                      title={`Back ${SKIP_BACK_SECONDS} s`}
                      disabled={!ready}
                      onMouseDown={keepFocus}
                      onClick={() => skip(-SKIP_BACK_SECONDS)}
                    >
                      <RotateCcw size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="podcast-play"
                      data-playing={playing || undefined}
                      aria-label={playing ? "Pause" : "Play"}
                      aria-keyshortcuts={playing ? undefined : "Meta+S"}
                      disabled={!audioSrc}
                      {...playTip.triggerProps}
                      onMouseDown={keepFocus}
                      onClick={() => playerRef.current?.toggle()}
                    >
                      <Play className="podcast-play-icon" data-icon="play" size={16} aria-hidden />
                      <Pause
                        className="podcast-play-icon"
                        data-icon="pause"
                        size={16}
                        aria-hidden
                      />
                    </button>
                    {playTip.tooltip}
                    <button
                      type="button"
                      className="podcast-skip"
                      aria-label={`Ahead ${SKIP_AHEAD_SECONDS} seconds`}
                      title={`Ahead ${SKIP_AHEAD_SECONDS} s`}
                      disabled={!ready}
                      onMouseDown={keepFocus}
                      onClick={() => skip(SKIP_AHEAD_SECONDS)}
                    >
                      <RotateCw size={16} aria-hidden />
                    </button>
                  </div>
                )}
              </div>

              {problem !== null ? (
                <>
                  <p className="podcast-message">{problem}</p>
                  <div className="podcast-tools">
                    <button type="button" className="video-pin-button" onClick={openLink}>
                      Open link
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {audioSrc ? (
                    <div className="podcast-timeline">
                      <span className="podcast-time">{formatVideoTime(time)}</span>
                      <input
                        type="range"
                        className="podcast-range podcast-track"
                        aria-label="Position"
                        aria-valuetext={`${formatVideoTime(time)} of ${formatVideoTime(duration)}`}
                        min={0}
                        max={duration || 0}
                        step={1}
                        value={Math.min(time, duration || 0)}
                        disabled={!duration}
                        style={{ "--fill": `${progress * 100}%` } as CSSProperties}
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
                    </div>
                  ) : (
                    <p className="podcast-message">Finding the episode…</p>
                  )}
                  <div className="podcast-tools">
                    <button
                      type="button"
                      className="video-pin-button podcast-speed"
                      aria-label={`Speed ${formatSpeed(prefs.rate)}`}
                      aria-keyshortcuts={SPEED_KEYSHORTCUTS}
                      onMouseDown={keepFocus}
                      onClick={() =>
                        setPrefs((value) => ({ ...value, rate: nextPodcastPreset(value.rate) }))
                      }
                    >
                      <span className="podcast-speed-value">{formatSpeed(prefs.rate)}</span>
                    </button>
                    <div className="podcast-volume">
                      <button
                        type="button"
                        className="video-pin-button podcast-mute"
                        aria-label={muted ? "Unmute" : "Mute"}
                        title={muted ? "Unmute" : "Mute"}
                        onMouseDown={keepFocus}
                        onClick={() => setVolume(muted ? unmuted : 0)}
                      >
                        {muted ? (
                          <VolumeX size={14} aria-hidden />
                        ) : (
                          <Volume2 size={14} aria-hidden />
                        )}
                      </button>
                      <input
                        type="range"
                        className="podcast-range podcast-volume-range"
                        aria-label="Volume"
                        aria-valuetext={`${Math.round(prefs.volume * 100)}%`}
                        min={0}
                        max={1}
                        step={0.01}
                        value={prefs.volume}
                        style={{ "--fill": `${prefs.volume * 100}%` } as CSSProperties}
                        onChange={(event) => setVolume(Number(event.currentTarget.value))}
                        onPointerUp={(event) => event.currentTarget.blur()}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
          {/* Under the card, not in it: ⌘S pins (there is no Pin button). */}
          {problem === null && <PlayerKeys playing={playing} />}
        </div>
      </div>
    </>
  );
}

/** The episode's picture: the first of `sources` that loads, faded in over
 *  a plain tile with a microphone, which also stands in when none does. */
function PodcastArtwork({ sources }: { sources: readonly (string | null)[] }) {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const src = sources.find((s): s is string => s !== null && !failed.includes(s)) ?? null;
  return (
    <div className="podcast-artwork">
      <Mic className="podcast-artwork-mark" size={22} aria-hidden />
      {/* The whole picture shows; a blurred copy fills the square around a
          picture that isn't one. */}
      {src && (
        <img
          key={`backdrop:${src}`}
          className="podcast-artwork-backdrop"
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          data-loaded={loaded === src || undefined}
        />
      )}
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          decoding="async"
          draggable={false}
          data-loaded={loaded === src || undefined}
          // A picture already in the cache can finish before React listens
          // for its load: check on mount as well.
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0) setLoaded(src);
          }}
          onLoad={() => setLoaded(src)}
          onError={() => {
            console.warn(`[podcast] Couldn't load the artwork ${src}`);
            setFailed((list) => [...list, src]);
          }}
        />
      )}
    </div>
  );
}
