import { type EditorView, WidgetType } from "@codemirror/view";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveEmbedPath } from "./wiki-embed-resolver";
import { formatClock } from "@/lib/talk/clock";
import "./audio-embed.css";

// `![[Recordings/2026-10-25 09.14.m4a]]` as a player (SPECs/talk-notes-spec.md#the-note-after-a-stop):
// play/pause, a bar you click or drag to scrub, the time. The widget keeps
// every pointer event, so using the player never drops the caret into the
// embed and swaps it for its source.

const ESTIMATED_HEIGHT = 58;

/** Every live player, by the path it plays, so a time link in the note can seek it. */
const players = new Map<string, Set<HTMLAudioElement>>();

/** Plays the take at `path` (as written in the note) from `seconds`; false when no player shows it. */
export function playRecordingAt(path: string, seconds: number): boolean {
  const audio = [...(players.get(path) ?? [])][0];
  if (!audio) return false;
  audio.currentTime = seconds;
  void audio.play();
  return true;
}

export class AudioEmbedWidget extends WidgetType {
  constructor(
    readonly rawText: string,
    readonly target: string,
    readonly workspaceRoot: string | null,
    readonly currentFilePath: string | null,
  ) {
    super();
  }

  eq(other: AudioEmbedWidget): boolean {
    return (
      this.rawText === other.rawText &&
      this.workspaceRoot === other.workspaceRoot &&
      this.currentFilePath === other.currentFilePath
    );
  }

  get estimatedHeight(): number {
    return ESTIMATED_HEIGHT;
  }

  toDOM(_view: EditorView): HTMLElement {
    const root = document.createElement("span");
    root.className = "cm-audio-embed";
    root.setAttribute("role", "group");
    const name = this.target.split("/").pop() ?? this.target;
    root.setAttribute("aria-label", `Recording ${name}`);

    const audio = document.createElement("audio");
    audio.preload = "metadata";

    const play = document.createElement("button");
    play.type = "button";
    play.className = "cm-audio-embed-play";
    play.setAttribute("aria-label", "Play");

    const middle = document.createElement("span");
    middle.className = "cm-audio-embed-middle";
    const title = document.createElement("span");
    title.className = "cm-audio-embed-name";
    title.textContent = name;
    const bar = document.createElement("span");
    bar.className = "cm-audio-embed-bar";
    bar.setAttribute("role", "slider");
    bar.setAttribute("aria-label", "Position");
    bar.tabIndex = 0;
    const fill = document.createElement("span");
    fill.className = "cm-audio-embed-fill";
    bar.append(fill);
    middle.append(title, bar);

    const time = document.createElement("span");
    time.className = "cm-audio-embed-time";
    time.textContent = "0:00";

    root.append(play, middle, time, audio);

    const paint = () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : 0;
      const at = audio.currentTime;
      fill.style.transform = `scaleX(${d ? Math.min(at / d, 1) : 0})`;
      time.textContent = d ? `${formatClock(at)} / ${formatClock(d)}` : formatClock(at);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", String(Math.round(d)));
      bar.setAttribute("aria-valuenow", String(Math.round(at)));
      bar.setAttribute("aria-valuetext", formatClock(at));
    };
    const setPlaying = (on: boolean) => {
      root.toggleAttribute("data-playing", on);
      play.setAttribute("aria-label", on ? "Pause" : "Play");
    };
    audio.addEventListener("loadedmetadata", paint);
    audio.addEventListener("timeupdate", paint);
    audio.addEventListener("play", () => setPlaying(true));
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("ended", () => setPlaying(false));
    play.addEventListener("click", () => {
      if (audio.paused) void audio.play();
      else audio.pause();
    });

    const seekTo = (clientX: number) => {
      const d = audio.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      const r = bar.getBoundingClientRect();
      audio.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * d;
      paint();
    };
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      try {
        bar.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointers (tests) can't be captured; the seek still applies.
      }
      seekTo(e.clientX);
    });
    bar.addEventListener("pointermove", (e) => {
      if (bar.hasPointerCapture?.(e.pointerId)) seekTo(e.clientX);
    });
    bar.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0;
      if (!step) return;
      e.preventDefault();
      audio.currentTime = Math.max(0, audio.currentTime + step);
    });

    let set = players.get(this.target);
    if (!set) players.set(this.target, (set = new Set()));
    set.add(audio);

    void resolveEmbedPath(this.target, this.workspaceRoot, this.currentFilePath)
      .then((absolutePath) => {
        if (absolutePath) audio.src = convertFileSrc(absolutePath);
        else this.renderPlaceholder(root);
      })
      .catch((error: unknown) => {
        console.error("[editor] Failed to resolve audio embed:", error);
        this.renderPlaceholder(root);
      });
    return root;
  }

  private renderPlaceholder(root: HTMLElement) {
    root.replaceChildren(this.rawText);
    root.classList.add("cm-audio-embed-unresolved");
  }

  destroy(dom: HTMLElement): void {
    const audio = dom.querySelector("audio");
    if (!audio) return;
    audio.pause();
    players.get(this.target)?.delete(audio);
  }

  ignoreEvent(): boolean {
    return true;
  }
}
