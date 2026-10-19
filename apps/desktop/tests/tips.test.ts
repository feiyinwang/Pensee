import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const prefs = new Map<string, unknown>();
vi.mock("@/lib/preferences", () => ({
  getPreference: async (key: string, fallback: unknown) => (prefs.has(key) ? prefs.get(key) : fallback),
  setPreference: async (key: string, value: unknown) => void prefs.set(key, value),
}));

import {
  TIPS,
  dueTip,
  tipsFinishedBy,
  tipsFinishedByEvent,
  tipsUsedInVault,
  type TipArrival,
} from "../src/components/tips/tips";
import {
  TIP_RULES,
  arriveAt,
  dismissTip,
  leaveAnchor,
  loadTips,
  noteTipEvent,
  noteTipKey,
  noteTipLine,
  resetTipsForTest,
  setTipGates,
  setTipsEnabled,
  useTipsStore,
} from "../src/components/tips/tips-store";

const never = () => false;
const none = () => 0;
const due = (arrival: TipArrival, done: (id: string) => boolean = never) =>
  dueTip(arrival, done, none)?.id ?? null;

const leave = (text: string, vaultNotes = 0): TipArrival => ({
  anchor: "editor",
  moment: "leave-line",
  path: "/v/a.md",
  kind: "note",
  line: 3,
  text,
  vaultNotes,
});
const open = (kind: "note" | "youtube" | "podcast" | "book"): TipArrival => ({
  anchor: "editor",
  moment: "open",
  path: "/v/a.md",
  kind,
  line: 2,
});

describe("tip registry", () => {
  test("every id is unique and every copy says Pensée, never the pen", () => {
    expect(new Set(TIPS.map((t) => t.id)).size).toBe(TIPS.length);
    for (const tip of TIPS) expect(tip.line).not.toMatch(/\bthe pen\b/i);
  });

  test("the registry keeps the spec's order", () => {
    expect(TIPS.map((t) => t.id)).toEqual([
      "library-empty",
      "library-open",
      "book-highlight",
      "video-pin",
      "podcast-pin",
      "pen-answer",
      "pen-check",
      "pen-connect",
      "pen-organize",
      "tabs-pinch",
      "board-dock",
      "go-key",
      "projects-move",
      "projects-empty",
      "calendar-period",
    ]);
  });

  test("Library: empty asks for a sample, with books asks to open one", () => {
    expect(due({ anchor: "library", items: 0, readerUsed: false })).toBe("library-empty");
    expect(due({ anchor: "library", items: 4, readerUsed: false })).toBe("library-open");
    expect(due({ anchor: "library", items: 4, readerUsed: true })).toBeNull();
  });

  test("a note's kind picks its tip when it opens", () => {
    expect(due(open("book"))).toBe("book-highlight");
    expect(due(open("youtube"))).toBe("video-pin");
    expect(due(open("podcast"))).toBe("podcast-pin");
    expect(due(open("note"))).toBeNull();
  });

  test("leaving a question asks for Answer; Pensée's own lines never do", () => {
    expect(due(leave("- Why do we forget what we read?"))).toBe("pen-answer");
    expect(due(leave("- Why do we forget? ^ai-s-abc"))).toBeNull();
    expect(due(leave("## Why?"))).toBeNull();
  });

  test("Check waits for Answer, then wants a 6-word bullet that isn't a question", () => {
    const claim = leave("- Spaced repetition beats rereading for long term memory");
    expect(due(claim)).toBeNull();
    const answered = (id: string) => id === "pen-answer";
    expect(due(claim, answered)).toBe("pen-check");
    expect(due(leave("- Too short a line"), answered)).toBeNull();
    expect(due(leave("Spaced repetition beats rereading for long term memory"), answered)).toBeNull();
  });

  test("Connect wants 20+ notes in the vault and a 6-word line", () => {
    const line = "Spaced repetition beats rereading for long term memory";
    expect(due(leave(line, 19))).toBeNull();
    expect(due(leave(line, 20))).toBe("pen-connect");
  });

  test("Organize wants 3+ selected lines", () => {
    const sel = (lines: number): TipArrival => ({
      anchor: "editor",
      moment: "select",
      path: "/v/a.md",
      line: 0,
      lines,
    });
    expect(due(sel(2))).toBeNull();
    expect(due(sel(3))).toBe("pen-organize");
  });

  test("tabs, board, sidebar, Projects and calendar", () => {
    expect(due({ anchor: "tabs", count: 2 })).toBeNull();
    expect(due({ anchor: "tabs", count: 3 })).toBe("tabs-pinch");
    expect(due({ anchor: "board", path: "/v/b.board.svg" })).toBe("board-dock");
    const row = { anchor: "sidebar", space: "library", name: "Library", letter: "L" } as const;
    expect(due({ ...row, clicks: 2 })).toBeNull();
    expect(due({ ...row, clicks: 3 })).toBe("go-key");
    expect(due({ anchor: "projects", cards: 0 })).toBe("projects-empty");
    expect(due({ anchor: "projects", cards: 5 })).toBe("projects-move");
    expect(due({ anchor: "calendar" })).toBe("calendar-period");
  });

  test("the go key names the row's own letter", () => {
    const tip = TIPS.find((t) => t.id === "go-key")!;
    const arrival = {
      anchor: "sidebar",
      space: "library",
      name: "Library",
      letter: "L",
      clicks: 3,
    } as const;
    expect(tip.keys!({ playing: false, time: "0:00" }, arrival)).toEqual({
      keys: ["⌘", "G", "L"],
      label: "Go to Library",
    });
  });

  test("the pin's pill says Play while paused and Pin to the time while playing", () => {
    const tip = TIPS.find((t) => t.id === "video-pin")!;
    expect(tip.keys!({ playing: false, time: "1:39:16" }, open("youtube")).label).toBe("Play");
    expect(tip.keys!({ playing: true, time: "1:39:16" }, open("youtube")).label).toBe(
      "Pin to 1:39:16",
    );
  });

  test("a done tip and a tip shown twice are skipped", () => {
    const arrival = { anchor: "library", items: 0, readerUsed: false } as const;
    expect(dueTip(arrival, (id) => id === "library-empty", none)).toBeNull();
    expect(dueTip(arrival, never, () => 2)).toBeNull();
    expect(dueTip(arrival, never, () => 1)?.id).toBe("library-empty");
  });
});

describe("tip done tests", () => {
  test("traces in the note", () => {
    expect(tipsFinishedBy("- a moment ^yt-5960")).toEqual(["video-pin", "podcast-pin"]);
    expect(tipsFinishedBy("- a passage ^bk-x1")).toEqual(["book-highlight"]);
    expect(tipsFinishedBy("  - sealed ^ai-s-1")).toEqual(["pen-answer"]);
    expect(tipsFinishedBy("  - for ^ai-p-1")).toEqual(["pen-check"]);
    expect(tipsFinishedBy("  - against ^ai-n-1")).toEqual(["pen-check"]);
    expect(tipsFinishedBy("  - echo ^ai-e-1")).toEqual(["pen-connect"]);
    expect(tipsFinishedBy("- topic ^ai-g-1")).toEqual(["pen-organize"]);
    expect(tipsFinishedBy("- plain line")).toEqual([]);
  });

  test("app events", () => {
    expect(tipsFinishedByEvent("columns-on")).toEqual(["tabs-pinch"]);
    expect(tipsFinishedByEvent("card-docked")).toEqual(["board-dock"]);
    expect(tipsFinishedByEvent("go-key")).toEqual(["go-key"]);
    expect(tipsFinishedByEvent("status-written")).toEqual(["projects-move"]);
    expect(tipsFinishedByEvent("project-created")).toEqual(["projects-empty"]);
    expect(tipsFinishedByEvent("period-note-opened")).toEqual(["calendar-period"]);
    expect(tipsFinishedByEvent("book-added")).toEqual(["library-empty"]);
    expect(tipsFinishedByEvent("reader-opened")).toEqual(["library-open"]);
  });

  test("the launch search marks used features done", () => {
    expect(tipsUsedInVault({ lines: [], hasBoard: false })).toEqual([]);
    const used = tipsUsedInVault({ lines: ["- x ^bk-1", "- y ^ai-e-2"], hasBoard: true });
    expect(used.sort()).toEqual(["board-dock", "book-highlight", "library-open", "pen-connect"]);
  });
});

describe("tips store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prefs.clear();
    resetTipsForTest();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const library = { anchor: "library", items: 0, readerUsed: false } as const;
  const active = () => useTipsStore.getState().active;

  test("a tip waits out the settle, then shows and counts one showing", () => {
    arriveAt(library);
    vi.advanceTimersByTime(TIP_RULES.settleMs - 1);
    expect(active()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(active()).toMatchObject({ id: "library-empty", phase: "ask" });
    expect(useTipsStore.getState().shown["library-empty"]).toBe(1);
    expect(prefs.get("tips.library-empty.shown")).toBe(1);
  });

  test("typing holds it back until 1.5s after the last key", () => {
    arriveAt(library);
    noteTipKey();
    vi.advanceTimersByTime(TIP_RULES.settleMs);
    expect(active()).toBeNull();
    vi.advanceTimersByTime(TIP_RULES.typingMs);
    expect(active()?.id).toBe("library-empty");
  });

  test("a menu, popover or onboarding holds it back", () => {
    let busy = true;
    setTipGates({ busy: () => busy });
    arriveAt(library);
    vi.advanceTimersByTime(TIP_RULES.settleMs * 3);
    expect(active()).toBeNull();
    busy = false;
    vi.advanceTimersByTime(TIP_RULES.retryMs);
    expect(active()?.id).toBe("library-empty");
  });

  test("one tip at a time: a second arrival waits for its next trigger", () => {
    arriveAt(library);
    vi.advanceTimersByTime(TIP_RULES.settleMs);
    arriveAt({ anchor: "calendar" });
    vi.advanceTimersByTime(TIP_RULES.settleMs * 2);
    expect(active()?.id).toBe("library-empty");
  });

  test("leaving before the settle cancels it, and nothing is counted", () => {
    arriveAt(library);
    leaveAnchor("library");
    vi.advanceTimersByTime(TIP_RULES.settleMs * 2);
    expect(active()).toBeNull();
    expect(useTipsStore.getState().shown["library-empty"]).toBeUndefined();
  });

  test("Not now hides it until the next arrival; after two showings it never comes back", () => {
    for (let i = 0; i < 2; i += 1) {
      arriveAt(library);
      vi.advanceTimersByTime(TIP_RULES.settleMs);
      expect(active()?.id).toBe("library-empty");
      dismissTip();
      expect(active()).toBeNull();
    }
    arriveAt(library);
    vi.advanceTimersByTime(TIP_RULES.settleMs * 2);
    expect(active()).toBeNull();
    expect(useTipsStore.getState().shown["library-empty"]).toBe(2);
  });

  test("leaving the page counts the showing like Not now", () => {
    arriveAt(library);
    vi.advanceTimersByTime(TIP_RULES.settleMs);
    leaveAnchor("library");
    expect(active()).toBeNull();
    expect(useTipsStore.getState().shown["library-empty"]).toBe(1);
  });

  test("done: the line says what happened for 2.4s, fades, and never shows again", () => {
    arriveAt(library);
    vi.advanceTimersByTime(TIP_RULES.settleMs);
    noteTipEvent("book-added");
    expect(active()).toMatchObject({ id: "library-empty", phase: "did" });
    expect(prefs.get("tips.library-empty.done")).toBe(true);
    // Leaving the page doesn't cut the done line short.
    leaveAnchor("library");
    expect(active()?.phase).toBe("did");
    vi.advanceTimersByTime(TIP_RULES.didMs);
    expect(active()?.phase).toBe("leaving");
    vi.advanceTimersByTime(TIP_RULES.leaveMs);
    expect(active()).toBeNull();
    arriveAt(library);
    vi.advanceTimersByTime(TIP_RULES.settleMs * 2);
    expect(active()).toBeNull();
  });

  test("a trace typed in a note finishes its tip even when it isn't showing", () => {
    noteTipLine("- what stuck ^yt-120");
    expect(useTipsStore.getState().done["video-pin"]).toBe(true);
    arriveAt(open("youtube"));
    vi.advanceTimersByTime(TIP_RULES.settleMs * 2);
    expect(active()).toBeNull();
  });

  test("Show tips off hides the one showing and stops new ones", () => {
    arriveAt(library);
    vi.advanceTimersByTime(TIP_RULES.settleMs);
    setTipsEnabled(false);
    expect(active()).toBeNull();
    arriveAt({ anchor: "calendar" });
    vi.advanceTimersByTime(TIP_RULES.settleMs * 2);
    expect(active()).toBeNull();
  });

  test("counts and done flags come back from preferences", async () => {
    vi.useRealTimers();
    prefs.set("tips.library-empty.shown", 2);
    prefs.set("tips.calendar-period.done", true);
    useTipsStore.setState({ loaded: false, shown: {}, done: {} });
    await loadTips();
    const state = useTipsStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.shown["library-empty"]).toBe(2);
    expect(state.done["calendar-period"]).toBe(true);
  });
});
