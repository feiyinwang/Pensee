import { useEffect, useState } from "react";
import {
  arriveAt,
  leaveAnchor,
  noteTipEvent,
  useTipsStore,
  type ActiveTip,
} from "@/components/tips/tips-store";
import type { TipAnchor, TipLive } from "@/components/tips/tips";
import { formatVideoTime } from "@/lib/video-pins";
import { videoPlayerFor } from "@/lib/video-players";

export type { ActiveTip };

/** The tip showing now, if it sits on `anchor` (any anchor when omitted). */
export function useActiveTip(anchor?: TipAnchor): ActiveTip | null {
  return useTipsStore((s) =>
    s.active && (!anchor || s.active.arrival.anchor === anchor) ? s.active : null,
  );
}

const STILL: TipLive = { playing: false, time: "0:00" };
/** How often the pill reads the player while it shows. */
const LIVE_MS = 500;

/** The video's state for a tip's pill (Play while paused, Pin to <time>
 *  while playing), read while the tip asks; the done line keeps the last
 *  reading, the moment it was pinned. */
export function useTipLive(active: ActiveTip | null): TipLive {
  const [live, setLive] = useState<TipLive>(STILL);
  const path = active?.arrival.anchor === "editor" ? active.arrival.path : null;
  const asking = active?.phase === "ask";
  useEffect(() => {
    if (!path || !asking) return;
    const read = () => {
      const player = videoPlayerFor(path);
      if (!player) return;
      const next = { playing: player.playing(), time: formatVideoTime(player.time()) };
      setLive((prev) => (prev.playing === next.playing && prev.time === next.time ? prev : next));
    };
    read();
    const timer = window.setInterval(read, LIVE_MS);
    return () => window.clearInterval(timer);
  }, [path, asking]);
  return live;
}

/** A book's reader opened (beside `notePath`, its note): the Library's
 *  "open a book" is done, and the note's highlight tip may be due. It goes
 *  when the reader closes. */
export function useBookTips(notePath: string | null): void {
  useEffect(() => {
    noteTipEvent("reader-opened");
    if (!notePath) return;
    arriveAt({ anchor: "editor", moment: "open", path: notePath, kind: "book" });
    return () =>
      leaveAnchor(
        "editor",
        (a) =>
          a.anchor === "editor" && a.moment === "open" && a.kind === "book" && a.path === notePath,
      );
  }, [notePath]);
}
