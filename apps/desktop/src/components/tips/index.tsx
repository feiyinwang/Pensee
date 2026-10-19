import { useEffect } from "react";
import { useActiveTip, useTipLive } from "@/hooks/use-tips";
import { useWorkspace } from "@/hooks/use-workspace";
import * as tauri from "@/lib/tauri";
import { GuideKeys, GuidePill } from "./guide-pill";
import { APP_TIP_GATES } from "./tips-gates";
import {
  dismissTip,
  finishTips,
  loadTips,
  noteTipKey,
  setTipGates,
  useTipsStore,
} from "./tips-store";
import { tipById, tipsUsedInVault } from "./tips";
import "./tips.css";

/** The in-context tips (SPECs/in-context-tips-spec.md): loads their counts,
 *  keeps the typing clock and Esc, runs the one launch search over the vault,
 *  and draws the guide pill with the showing tip's keys. Each tip's line is
 *  drawn where the move happens: `<TipLine>` on a page, the editor's tip
 *  placeholder in a note. */
export function Tips() {
  useEffect(() => {
    setTipGates(APP_TIP_GATES);
    void loadTips();
    // Capture, so a key an editor or menu swallows still counts as typing.
    const onKey = () => noteTipKey();
    const onEsc = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (useTipsStore.getState().active?.phase === "ask") dismissTip();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onEsc);
    };
  }, []);
  useVaultTraces();
  return <TipPill />;
}

/** Once per opened vault, after its index is built and the app is idle: the
 *  tips for features already used there are done. */
function useVaultTraces(): void {
  const { root, isIndexing } = useWorkspace();
  const ready = root !== null && !isIndexing;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const run = () => {
      tauri
        .findTipTraces()
        .then(({ traces, has_board }) => {
          if (live) finishTips(tipsUsedInVault({ lines: traces, hasBoard: has_board }));
        })
        .catch((error: unknown) => console.error("[tips] The vault search failed:", error));
    };
    // Off the launch path: wait for the first idle moment.
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(run, { timeout: 5000 })
      : window.setTimeout(run, 2000);
    return () => {
      live = false;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [root, ready]);
}

/** The pill: the move's keys, its name, and Not now. A tip with no keys has
 *  none: its line ends in Not now. */
function TipPill() {
  const active = useActiveTip();
  const tip = active ? tipById(active.id) : null;
  const live = useTipLive(active && tip?.keys ? active : null);
  if (!active || !tip?.keys) return null;
  const { keys, label } = tip.keys(live, active.arrival);
  return (
    <GuidePill
      leaving={active.phase === "leaving"}
      quiet={active.phase === "ask" ? { label: "Not now", onClick: dismissTip } : undefined}
    >
      <span className="guide-pill-msg" data-tip={tip.id}>
        <GuideKeys keys={keys} />
        <span className={keys.length ? "guide-pill-label" : undefined}>{label}</span>
      </span>
    </GuidePill>
  );
}
