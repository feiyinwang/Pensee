import { PIN_SHORTCUT_LABEL, SLOWER_SHORTCUT_LABEL, FASTER_SHORTCUT_LABEL } from "./video-pin";

/**
 * The line under a YouTube or podcast player naming its keys in full, each a
 * label then its key. ⌘S is named for what it does now: Play while paused,
 * Pin (and pause) while playing.
 */
export function PlayerKeys({ playing }: { playing: boolean }) {
  return (
    <div className="player-keys" aria-hidden>
      <span className="player-key">
        {playing ? "Pin" : "Play"}
        <kbd>{PIN_SHORTCUT_LABEL}</kbd>
      </span>
      <span className="player-key">
        Slower
        <kbd>{SLOWER_SHORTCUT_LABEL}</kbd>
      </span>
      <span className="player-key">
        Faster
        <kbd>{FASTER_SHORTCUT_LABEL}</kbd>
      </span>
    </div>
  );
}
