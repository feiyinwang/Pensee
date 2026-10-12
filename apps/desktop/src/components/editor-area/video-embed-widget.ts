import { type EditorView, WidgetType } from "@codemirror/view";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveEmbedPath } from "./wiki-embed-resolver";
import "./video-embed.css";

// `![[clip.mp4]]` as a player, per SPECs/x-bookmarks-spec.md. A `*-gif.mp4`
// plays like a GIF: looping and muted, paused under Reduce Motion, and a
// click toggles it. The widget keeps every pointer event, so using the
// controls never drops the caret into the embed and swaps it for its source.

const ESTIMATED_HEIGHT = 340;

export class VideoEmbedWidget extends WidgetType {
  constructor(
    readonly rawText: string,
    readonly target: string,
    readonly gif: boolean,
    readonly workspaceRoot: string | null,
    readonly currentFilePath: string | null,
  ) {
    super();
  }

  eq(other: VideoEmbedWidget): boolean {
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
    const elem = document.createElement("span");
    elem.className = "cm-video-embed";
    const video = document.createElement("video");
    video.preload = "metadata";
    video.playsInline = true;
    if (this.gif) {
      elem.dataset.gif = "";
      video.muted = true;
      video.loop = true;
      video.autoplay = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      video.setAttribute("aria-label", "GIF, click to play or pause");
      video.addEventListener("click", () => {
        if (video.paused) void video.play();
        else video.pause();
      });
      const badge = document.createElement("span");
      badge.className = "cm-video-embed-badge";
      badge.textContent = "GIF";
      elem.appendChild(badge);
    } else {
      video.controls = true;
    }
    elem.prepend(video);

    void resolveEmbedPath(this.target, this.workspaceRoot, this.currentFilePath)
      .then((absolutePath) => {
        if (absolutePath) {
          // `#t=0.1` makes WebKit draw the first frame instead of black.
          video.src = `${convertFileSrc(absolutePath)}${this.gif ? "" : "#t=0.1"}`;
        } else {
          this.renderPlaceholder(elem);
        }
      })
      .catch((error: unknown) => {
        console.error("[editor] Failed to resolve video embed:", error);
        this.renderPlaceholder(elem);
      });
    return elem;
  }

  private renderPlaceholder(elem: HTMLElement) {
    elem.replaceChildren(this.rawText);
    elem.classList.add("cm-video-embed-unresolved");
  }

  destroy(dom: HTMLElement): void {
    dom.querySelector("video")?.pause();
  }

  ignoreEvent(): boolean {
    return true;
  }
}
