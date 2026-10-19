import { useEffect, useRef } from "react";
import { useActiveTip, useTipLive } from "@/hooks/use-tips";
import { arriveAt, dismissTip, leaveAnchor } from "./tips-store";
import { tipById, type TipAnchor, type TipArrival } from "./tips";
import "./tips.css";

/** A tip's line on a page (SPECs/in-context-tips-spec.md): faint italic words
 *  in the page's nearest empty space, placed by the page itself. With an
 *  `arrival`, it also reports the page opening and leaving (useTipArrival).
 *  `match` picks which of several lines on the anchor shows the tip (one row
 *  of the sidebar). `actions` are a tip's own quiet links (Add it). */
export function TipLine({
  anchor,
  arrival,
  match,
  actions,
  className,
  inline = false,
}: {
  anchor: TipAnchor;
  arrival?: TipArrival | null;
  match?: (arrival: TipArrival) => boolean;
  actions?: Readonly<Record<string, { label: string; run: () => void }>>;
  className?: string;
  /** Inside a row's own button: a span, never a second button. */
  inline?: boolean;
}) {
  useTipArrival(anchor, arrival);
  const active = useActiveTip(anchor);
  const tip = active ? tipById(active.id) : null;
  const live = useTipLive(active && tip?.keys ? active : null);
  if (!active || !tip || (match && !match(active.arrival))) return null;
  const action = actions?.[tip.id];
  const Tag = inline ? "span" : "div";
  return (
    <Tag
      className={`tip-line${className ? ` ${className}` : ""}`}
      data-tip={tip.id}
      data-phase={active.phase}
      role="status"
    >
      {active.phase === "ask" ? (
        <>
          <span>{tip.line}</span>
          {action && !inline && (
            <button type="button" className="tip-line-act" onClick={action.run}>
              {action.label}
            </button>
          )}
          {!tip.keys && !inline && (
            <button type="button" className="tip-line-not-now" onClick={dismissTip}>
              Not now <kbd>Esc</kbd>
            </button>
          )}
        </>
      ) : (
        <span>{tip.did(live)}</span>
      )}
    </Tag>
  );
}

/** Reports an arrival at `anchor` when `arrival` first becomes known (a page
 *  still loading passes null) and again each time `moment` changes, and the
 *  leaving when it goes back to null or the component unmounts. */
export function useTipArrival(
  anchor: TipAnchor,
  arrival: TipArrival | null | undefined,
  moment: string | number = "mount",
): void {
  const latest = useRef(arrival);
  latest.current = arrival;
  const known = arrival !== undefined && arrival !== null;
  useEffect(() => {
    const now = latest.current;
    if (!known || !now) return;
    arriveAt(now);
    return () => leaveAnchor(anchor);
  }, [anchor, known, moment]);
}
