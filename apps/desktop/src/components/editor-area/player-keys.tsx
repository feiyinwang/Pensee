import {
  PIN_SHORTCUT_LABEL,
  SCREENSHOT_SHORTCUT_LABEL,
  SLOWER_SHORTCUT_LABEL,
  FASTER_SHORTCUT_LABEL,
} from "./video-pin";
import { keyLabel } from "@/lib/platform";

/**
 * The line under a YouTube or podcast player naming its keys in full, each a
 * label then its key. ⌘S is named for what it does now: Play while paused,
 * Pin (and pause) while playing. Only a video has **Screenshot** (⌘⇧S).
 */
export function PlayerKeys({ playing, video = false }: { playing: boolean; video?: boolean }) {
  return (
    <div className="player-keys" aria-hidden>
      <span className="player-key">
        {playing ? "Pin" : "Play"}
        <kbd>{keyLabel(PIN_SHORTCUT_LABEL)}</kbd>
      </span>
      {video && (
        <span className="player-key">
          Screenshot
          <kbd>{keyLabel(SCREENSHOT_SHORTCUT_LABEL)}</kbd>
        </span>
      )}
      <span className="player-key">
        Slower
        <kbd>{keyLabel(SLOWER_SHORTCUT_LABEL)}</kbd>
      </span>
      <span className="player-key">
        Faster
        <kbd>{keyLabel(FASTER_SHORTCUT_LABEL)}</kbd>
      </span>
    </div>
  );
}
