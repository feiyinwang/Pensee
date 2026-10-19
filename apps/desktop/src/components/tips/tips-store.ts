import { create } from "zustand";
import { getPreference, setPreference } from "@/lib/preferences";
import {
  TIPS,
  dueTip,
  tipById,
  tipsFinishedBy,
  tipsFinishedByEvent,
  type TipAnchor,
  type TipArrival,
  type TipEvent,
} from "./tips";

/** The rules (SPECs/in-context-tips-spec.md § When a tip shows). */
export const TIP_RULES = {
  /** A tip waits this long after you arrive. */
  settleMs: 600,
  /** …and never shows within this long of a key. */
  typingMs: 1500,
  /** How often a held-back tip looks again. */
  retryMs: 300,
  /** At most this many showings. */
  maxShown: 2,
  /** How long the done line stays before it fades. */
  didMs: 2400,
  /** The fade: `--motion-base`. */
  leaveMs: 160,
} as const;

export type TipPhase = "ask" | "did" | "leaving";

export interface ActiveTip {
  id: string;
  arrival: TipArrival;
  phase: TipPhase;
}

interface TipsState {
  /** Clicks on each Space's sidebar row (the go key's trigger), by space. */
  spaceClicks: Readonly<Record<string, number>>;
  /** Counts and done flags are read from preferences: no tip shows before. */
  loaded: boolean;
  /** Settings → General → Show tips. */
  enabled: boolean;
  shown: Readonly<Record<string, number>>;
  done: Readonly<Record<string, boolean>>;
  active: ActiveTip | null;
}

export const useTipsStore = create<TipsState>(() => ({
  loaded: false,
  enabled: true,
  spaceClicks: {},
  shown: {},
  done: {},
  active: null,
}));

/** What holds a due tip back. Swappable in tests; the app's own reads the
 *  DOM and the onboarding store (tips-gates.ts). */
export interface TipGates {
  /** Onboarding is open, or a menu, popover, dialog or the pen's box. */
  busy: () => boolean;
}

let gates: TipGates = { busy: () => false };
let lastKeyAt = Number.NEGATIVE_INFINITY;
const now = () => performance.now();

export function setTipGates(next: TipGates): void {
  gates = next;
}

/** A key was pressed: typing holds tips back (TIP_RULES.typingMs). */
export function noteTipKey(): void {
  lastKeyAt = now();
}

const ORDER = new Map(TIPS.map((tip, i) => [tip.id, i]));
const order = (id: string) => ORDER.get(id) ?? TIPS.length;
const isDone = (id: string) => useTipsStore.getState().done[id] === true;
const shownCount = (id: string) => useTipsStore.getState().shown[id] ?? 0;

/* ------------------------------------------------------------ persistence */

const SPACE_CLICKS_KEY = "tips.space-clicks";
const shownKey = (id: string) => `tips.${id}.shown`;
const doneKey = (id: string) => `tips.${id}.done`;

/** Reads every tip's count and done flag. Called once, at launch. */
export async function loadTips(): Promise<void> {
  const clicks = getPreference<Record<string, number>>(SPACE_CLICKS_KEY, {});
  const entries = await Promise.all(
    TIPS.map(async (tip) => {
      const [shown, done] = await Promise.all([
        getPreference<number>(shownKey(tip.id), 0),
        getPreference<boolean>(doneKey(tip.id), false),
      ]);
      return [tip.id, shown, done] as const;
    }),
  );
  const shown: Record<string, number> = {};
  const done: Record<string, boolean> = {};
  for (const [id, s, d] of entries) {
    if (s > 0) shown[id] = s;
    if (d) done[id] = true;
  }
  const state = useTipsStore.getState();
  // A tip finished before the load landed stays finished.
  const spaceClicks = await clicks;
  useTipsStore.setState({
    loaded: true,
    shown,
    done: { ...done, ...state.done },
    spaceClicks: { ...spaceClicks, ...state.spaceClicks },
  });
  const waiting = early;
  early = [];
  for (const arrival of waiting) arriveAt(arrival);
}

/** Settings → General → Show tips. Off hides the one showing now. */
export function setTipsEnabled(enabled: boolean): void {
  if (useTipsStore.getState().enabled === enabled) return;
  useTipsStore.setState({ enabled });
  if (!enabled) clearTip();
}

/* ------------------------------------------------------------ scheduling */

interface Pending {
  id: string;
  arrival: TipArrival;
  timer: ReturnType<typeof setTimeout> | undefined;
}

let pending: Pending | null = null;
let early: TipArrival[] = [];
let phaseTimer: ReturnType<typeof setTimeout> | null = null;

function clearPending(): void {
  if (pending) clearTimeout(pending.timer);
  pending = null;
}

function clearPhaseTimer(): void {
  if (phaseTimer !== null) clearTimeout(phaseTimer);
  phaseTimer = null;
}

/** You arrived somewhere a tip may be due: the first due tip in the
 *  registry's order waits out the settle, then shows once nothing holds it
 *  back. A tip already showing stays; the new one waits for its next
 *  trigger. */
export function arriveAt(arrival: TipArrival): void {
  const state = useTipsStore.getState();
  if (!state.loaded) {
    // Before the counts load (a note restored at launch): the latest arrival
    // per anchor waits for them.
    early = [...early.filter((a) => a.anchor !== arrival.anchor), arrival];
    return;
  }
  if (!state.enabled) return;
  if (state.active) return;
  const tip = dueTip(arrival, isDone, shownCount, TIP_RULES.maxShown);
  if (!tip) return;
  // Two due: the first in the registry's order goes, the other waits for its
  // next trigger. The same tip due again starts its settle over.
  if (pending && order(pending.id) < order(tip.id)) return;
  clearPending();
  const settle: Pending = { id: tip.id, arrival, timer: undefined };
  settle.timer = setTimeout(() => tryShow(settle), TIP_RULES.settleMs);
  pending = settle;
}

function tryShow(waiting: Pending): void {
  if (pending !== waiting) return;
  const state = useTipsStore.getState();
  if (!state.enabled || state.active || isDone(waiting.id)) {
    clearPending();
    return;
  }
  if (now() - lastKeyAt < TIP_RULES.typingMs || gates.busy()) {
    waiting.timer = setTimeout(() => tryShow(waiting), TIP_RULES.retryMs);
    return;
  }
  pending = null;
  // Each showing counts, whether it ends in Not now or you leave.
  const shown = shownCount(waiting.id) + 1;
  useTipsStore.setState({
    active: { id: waiting.id, arrival: waiting.arrival, phase: "ask" },
    shown: { ...state.shown, [waiting.id]: shown },
  });
  void setPreference(shownKey(waiting.id), shown);
}

/** You left the anchor (the page closed, another note opened): its tip, or
 *  the one waiting for it, goes. A done line plays out. */
export function leaveAnchor(anchor: TipAnchor, matches?: (arrival: TipArrival) => boolean): void {
  if (pending && tipById(pending.id)?.anchor === anchor) {
    if (!matches || matches(pending.arrival)) clearPending();
  }
  const active = useTipsStore.getState().active;
  if (active?.phase !== "ask" || tipById(active.id)?.anchor !== anchor) return;
  if (matches && !matches(active.arrival)) return;
  clearTip();
}

/** Not now, or Esc: hidden until your next arrival. */
export function dismissTip(): void {
  if (useTipsStore.getState().active?.phase !== "ask") return;
  clearTip();
}

function clearTip(): void {
  clearPhaseTimer();
  if (useTipsStore.getState().active) useTipsStore.setState({ active: null });
}

/** These tips are done: they never show again, and the one showing says
 *  what happened, then fades. */
export function finishTips(ids: readonly string[]): void {
  const state = useTipsStore.getState();
  const fresh = ids.filter((id) => !state.done[id]);
  if (fresh.length === 0) return;
  const done = { ...state.done };
  for (const id of fresh) {
    done[id] = true;
    void setPreference(doneKey(id), true);
  }
  const active = state.active;
  const playsOut = active !== null && active.phase === "ask" && fresh.includes(active.id);
  useTipsStore.setState(playsOut ? { done, active: { ...active, phase: "did" } } : { done });
  if (pending && fresh.includes(pending.id)) clearPending();
  if (!playsOut) return;
  clearPhaseTimer();
  phaseTimer = setTimeout(() => {
    setPhase("leaving");
    phaseTimer = setTimeout(clearTip, TIP_RULES.leaveMs);
  }, TIP_RULES.didMs);
}

function setPhase(phase: TipPhase): void {
  const active = useTipsStore.getState().active;
  if (active && active.phase !== phase) useTipsStore.setState({ active: { ...active, phase } });
}

/** An app event happened: the tips it finishes are done. */
export function noteTipEvent(event: TipEvent): void {
  finishTips(tipsFinishedByEvent(event));
}

/** A line of a note changed: the tips its trace finishes are done. */
export function noteTipLine(text: string): void {
  const ids = tipsFinishedBy(text);
  if (ids.length > 0) finishTips(ids);
}

/** A Space's sidebar row was clicked: counted, then reported (the go key's
 *  tip names the row's own letter). */
export function clickSpaceRow(row: { space: string; name: string; letter: string }): void {
  const state = useTipsStore.getState();
  const clicks = (state.spaceClicks[row.space] ?? 0) + 1;
  const spaceClicks = { ...state.spaceClicks, [row.space]: clicks };
  useTipsStore.setState({ spaceClicks });
  void setPreference(SPACE_CLICKS_KEY, spaceClicks);
  arriveAt({ anchor: "sidebar", ...row, clicks });
}

/** Tests: back to a fresh launch. */
export function resetTipsForTest(): void {
  clearPending();
  clearPhaseTimer();
  early = [];
  lastKeyAt = Number.NEGATIVE_INFINITY;
  gates = { busy: () => false };
  useTipsStore.setState({
    loaded: true,
    enabled: true,
    shown: {},
    done: {},
    spaceClicks: {},
    active: null,
  });
}
