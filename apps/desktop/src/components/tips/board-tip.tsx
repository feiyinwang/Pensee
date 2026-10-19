import { createRoot } from "react-dom/client";
import { TipLine } from "./tip-line";

/** A board opened (full screen or in its note): its tip's line goes in the
 *  canvas's empty space, at the top of `host`. The board is drawn without
 *  React, so the line gets a small root of its own. Returns the teardown. */
export function mountBoardTip(host: HTMLElement): () => void {
  const slot = document.createElement("div");
  slot.className = "tip-board-slot";
  host.append(slot);
  const root = createRoot(slot);
  root.render(<TipLine anchor="board" arrival={{ anchor: "board" }} className="tip-line-board" />);
  // A board can close from inside a React render (a click in the app's
  // own UI): unmounting a root then is refused, so it waits a tick.
  return () => {
    slot.remove();
    queueMicrotask(() => root.unmount());
  };
}
