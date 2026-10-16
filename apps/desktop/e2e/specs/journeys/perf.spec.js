// Speed journeys (PERF in docs/qa/performance.md). Each one times a user
// action inside the page, from the input event until the app has drawn the
// answer and is free for the next input, then holds the median to the
// action's budget and to the last recorded baseline (e2e/qa/perf-baseline.json).
//
// Actions are driven by clicks and typing, never by shortcut keys, so a
// shortcut remap doesn't break the timings. PENSEE_PERF_UPDATE=1 writes the
// medians of the journeys that ran into the baseline.
import { ok } from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { invoke, waitForTitle, workspaceRoot } from "./_helpers.js";

const BASELINE = resolve(dirname(fileURLToPath(import.meta.url)), "../../qa/perf-baseline.json");

/** Budgets by kind of action, in ms (docs/qa/performance.md, "Budgets"). */
const BUDGET = { type: 16, show: 50, go: 100 };
/** Slower than the baseline by more than both of these is a regression. */
const REGRESSION_RATIO = 1.25;
const REGRESSION_FLOOR_MS = 2;
const RUNS = 9;
const WARMUP = 2;

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const measured = {};

/** In-page timer: runs `act`, waits (on DOM mutations) until `ready()` holds,
 *  lets queued work drain (one MessageChannel hop: React's passive effects,
 *  CodeMirror's DOM flush), forces style and layout, and resolves with the
 *  elapsed ms. Paint is not included; the hidden e2e window doesn't paint on
 *  schedule. */
function installTimer() {
  window.__perfTime = (act, ready, timeout = 3_000) =>
    new Promise((resolve, reject) => {
      let done = false;
      const t0 = performance.now();
      const finish = () => {
        done = true;
        observer.disconnect();
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          void document.documentElement.offsetHeight;
          resolve(performance.now() - t0);
        };
        channel.port2.postMessage(0);
      };
      const observer = new MutationObserver(() => {
        if (!done && ready()) finish();
      });
      observer.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      setTimeout(() => {
        if (done) return;
        done = true;
        observer.disconnect();
        reject(new Error("never became ready"));
      }, timeout);
      act();
      if (!done && ready()) finish();
    });
  /** A mouse click at the element's centre, as `mouseClick` sends it. */
  window.__perfClick = (el) => {
    const box = el.getBoundingClientRect();
    const at = {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...at, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mousedown", at));
    el.dispatchEvent(new PointerEvent("pointerup", { ...at, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mouseup", at));
    el.dispatchEvent(new MouseEvent("click", at));
  };
}

/** Run `timed` (which resolves `{ ms }` or `{ error }` from the page) WARMUP +
 *  RUNS times with `arrange` before each, untimed, and return the samples. */
async function sample(arrange, timed) {
  const samples = [];
  for (let i = 0; i < WARMUP + RUNS; i++) {
    if (arrange) await arrange(i);
    const result = await timed(i);
    if (result?.error) throw new Error(`run ${i}: ${result.error}`);
    if (i >= WARMUP) samples.push(result.ms);
  }
  return samples;
}

/** Hold the median to the budget and to the baseline, and log the line the
 *  QA report quotes. */
function judge(id, kind, samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const worst = sorted[sorted.length - 1];
  const budget = BUDGET[kind];
  const base = baseline[id]?.median;
  measured[id] = { median: Number(median.toFixed(1)), kind };
  const vs = base === undefined ? "no baseline" : `baseline ${base}ms`;
  console.log(
    `PERF ${id} median ${median.toFixed(1)}ms, worst ${worst.toFixed(1)}ms ` +
      `(budget ${budget}ms, ${vs})`,
  );
  ok(median <= budget, `${id} takes ${median.toFixed(1)}ms, over its ${budget}ms budget`);
  if (base !== undefined) {
    const regressed = median > base * REGRESSION_RATIO && median - base > REGRESSION_FLOOR_MS;
    ok(!regressed, `${id} got slower: ${median.toFixed(1)}ms, was ${base}ms`);
    if (median < base / REGRESSION_RATIO && base - median > REGRESSION_FLOOR_MS) {
      console.log(`PERF ${id} is faster than its baseline: lock it in with PENSEE_PERF_UPDATE=1`);
    }
  }
}

async function closeSearch() {
  if (!(await $("[cmdk-input]").isExisting())) return;
  await browser.keys("Escape");
  await $("[cmdk-input]").waitForExist({ timeout: 5_000, reverse: true });
}

async function openSearch() {
  await closeSearch();
  await $("[data-sidebar-surface-content] [data-sidebar-search-button]").click();
  await $("[cmdk-input]").waitForExist({ timeout: 5_000 });
  await $("[cmdk-item]").waitForExist({ timeout: 5_000 });
}

/** Search for `name`, untimed, and leave its row ready to open with Enter. */
async function searchFor(name) {
  await openSearch();
  await browser.execute((value) => {
    const field = document.querySelector("[cmdk-input]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);
  await $(`//*[@cmdk-item][contains(., "${name}")]`).waitForExist({ timeout: 5_000 });
}

async function openNote(name) {
  await searchFor(name);
  await $(`//*[@cmdk-item][contains(., "${name}")]`).click();
  await waitForTitle(name);
}

describe("Journeys: speed", function () {
  let root;

  before(async function () {
    root = await workspaceRoot();
    await $("[data-sidebar-surface-content] [data-sidebar-search-button]").waitForExist({
      timeout: 10_000,
    });
    // The launch splash covers the window for its first seconds (WS-05).
    await $(".app-splash").waitForExist({ timeout: 10_000, reverse: true });
    await browser.execute(installTimer);
  });

  after(function () {
    if (process.env.PENSEE_PERF_UPDATE !== "1" || Object.keys(measured).length === 0) return;
    const next = { ...baseline, ...measured };
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`PERF baseline updated: ${Object.keys(measured).join(", ")}`);
  });

  it("PERF-01 a letter typed in a long note shows at once", async function () {
    await openNote("Long essay");
    const samples = await sample(null, () =>
      browser.executeAsync((done) => {
        const scope = document.querySelector("[data-column-tab][data-focused]") ?? document;
        // A line on screen: CodeMirror draws only the viewport, and the rest
        // of a long note is gap placeholders it ignores typing in.
        const line = [...scope.querySelectorAll(".cm-content .cm-line")].find((el) =>
          el.textContent.includes("keeps going"),
        );
        if (!line) return done({ error: "no 'keeps going' line on screen" });
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()) && !node.data.includes("keeps going"));
        if (!node) return done({ error: "no 'keeps going' text" });
        const at = node.data.indexOf("keeps going") + "keeps going".length;
        const before = line.textContent.length;
        window
          .__perfTime(
            () => {
              line.closest(".cm-content").focus();
              const range = document.createRange();
              range.setStart(node, at);
              range.collapse(true);
              const selection = window.getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
              document.execCommand("insertText", false, "x");
            },
            () => line.isConnected && line.textContent.length > before,
          )
          .then(
            (ms) => done({ ms }),
            (error) => done({ error: String(error) }),
          );
      }),
    );
    // CodeMirror took every letter, not just the DOM: they reach the file.
    const path = `${root}/Notes/Long essay.md`;
    const typed = `keeps going${"x".repeat(WARMUP + RUNS)}`;
    await browser.waitUntil(
      async () => ((await invoke("read_file", { path })).value?.content ?? "").includes(typed),
      { timeout: 5_000, timeoutMsg: "the typed letters never reached Long essay.md" },
    );
    judge("PERF-01", "type", samples);
  });

  it("PERF-02 clicking Search opens the search palette", async function () {
    const samples = await sample(closeSearch, () =>
      browser.executeAsync((done) => {
        const button = document.querySelector(
          "[data-sidebar-surface-content] [data-sidebar-search-button]",
        );
        window
          .__perfTime(
            () => window.__perfClick(button),
            () => document.querySelector("[cmdk-input]") && document.querySelector("[cmdk-item]"),
          )
          .then(
            (ms) => done({ ms }),
            (error) => done({ error: String(error) }),
          );
      }),
    );
    await closeSearch();
    judge("PERF-02", "show", samples);
  });

  it("PERF-03 typing in search narrows the results", async function () {
    const samples = await sample(openSearch, () =>
      browser.executeAsync((done) => {
        const field = document.querySelector("[cmdk-input]");
        const before = document.querySelectorAll("[cmdk-item]").length;
        window
          .__perfTime(
            () => {
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
                field,
                "Long ess",
              );
              field.dispatchEvent(new Event("input", { bubbles: true }));
            },
            () => {
              const items = [...document.querySelectorAll("[cmdk-item]")];
              return (
                items.length < before && items.some((el) => el.textContent.includes("Long essay"))
              );
            },
          )
          .then(
            (ms) => done({ ms }),
            (error) => done({ error: String(error) }),
          );
      }),
    );
    await closeSearch();
    judge("PERF-03", "show", samples);
  });

  it("PERF-04 Enter on a search result opens the long note", async function () {
    const samples = await sample(
      async () => {
        await openNote("Welcome");
        await searchFor("Long essay");
      },
      () =>
        browser.executeAsync((done) => {
          const field = document.querySelector("[cmdk-input]");
          const front = () => {
            const scope = document.querySelector("[data-column-tab][data-focused]") ?? document;
            return [...scope.querySelectorAll("[data-page-title]")].find((el) => el.offsetParent);
          };
          window
            .__perfTime(
              () =>
                field.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
                ),
              () => front()?.value === "Long essay" && !document.querySelector("[cmdk-input]"),
            )
            .then(
              (ms) => done({ ms }),
              (error) => done({ error: String(error) }),
            );
        }),
    );
    judge("PERF-04", "go", samples);
  });

  it("PERF-05 hiding and showing the sidebar", async function () {
    const samples = await sample(null, () =>
      browser.executeAsync((done) => {
        const hide = document.querySelector('button[aria-label="Hide sidebar"]');
        const button = hide ?? document.querySelector('button[aria-label="Show sidebar"]');
        if (!button) return done({ error: "no sidebar toggle" });
        const want = hide ? "Show sidebar" : "Hide sidebar";
        window
          .__perfTime(
            () => window.__perfClick(button),
            () => document.querySelector(`button[aria-label="${want}"]`),
          )
          .then(
            (ms) => done({ ms }),
            (error) => done({ error: String(error) }),
          );
      }),
    );
    // Leave the sidebar showing for the next journey.
    if (await $('button[aria-label="Show sidebar"]').isExisting()) {
      await $('button[aria-label="Show sidebar"]').click();
    }
    judge("PERF-05", "show", samples);
  });

  it("PERF-06 clicking a space in the sidebar opens it", async function () {
    const spaces = ["projects", "library", "files"];
    const samples = await sample(null, (i) =>
      browser.executeAsync(
        (key, done) => {
          const button = document.querySelector(`button[data-space-key="${key}"]`);
          if (!button) return done({ error: `no ${key} space` });
          window
            .__perfTime(
              () => window.__perfClick(button),
              () => button.getAttribute("aria-current") === "page",
            )
            .then(
              (ms) => done({ ms }),
              (error) => done({ error: String(error) }),
            );
        },
        spaces[i % spaces.length],
      ),
    );
    judge("PERF-06", "go", samples);
  });

  it("PERF-07 a drag step on a board while a dock is offered", async function () {
    await openNote("Dock board");
    const card = await $(".wr-board-card");
    await card.waitForExist({ timeout: 10_000 });
    await card.click();
    await $('.wr-board-fullscreen [data-el="b1"]').waitForExist({ timeout: 10_000 });
    // The board fits itself to the window as it opens (its is-open class waits
    // on an animation frame, which the hidden window doesn't run): wait until
    // the cards stop moving.
    let fitted = "";
    await browser.waitUntil(
      async () => {
        const now = await browser.execute(() =>
          JSON.stringify(
            document.querySelector('.wr-board-fullscreen [data-el="a1"]').getBoundingClientRect(),
          ),
        );
        const still = now === fitted;
        fitted = now;
        return still;
      },
      { timeout: 10_000, interval: 250, timeoutMsg: "the board never settled after opening" },
    );
    // Each sample is its own gesture: press on Writing (untimed), then time
    // one move that brings it within reach of Thinking. The first move of a
    // gesture is handled at once; later ones wait for animation frames, which
    // the hidden window barely runs. A gesture ends with ⌥ held, so nothing
    // docks and the next press finds the same board. Synthetic pointers
    // can't be captured, so capture is stubbed on the board's svg.
    await browser.execute(() => {
      const svg = document.querySelector(".wr-board-fullscreen svg.wr-board-svg");
      svg.setPointerCapture = () => {};
      svg.releasePointerCapture = () => {};
      const rect = (id) =>
        document.querySelector(`.wr-board-fullscreen [data-el="${id}"]`).getBoundingClientRect();
      const send = (type, p, altKey = false) =>
        svg.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: p.x,
            clientY: p.y,
            altKey,
          }),
        );
      let last = null;
      window.__perfBoard = {
        release() {
          if (!last) return;
          send("pointermove", last, true);
          send("pointerup", last, true);
          last = null;
        },
        press() {
          this.release();
          const b = rect("b1");
          last = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
          send("pointerdown", last);
        },
        /** Where Writing rests 60 under Thinking, 30 left or right: far enough
         *  from where the last sample left it (it may have snapped) that the
         *  move always starts a drag. */
        near(n) {
          const a = rect("a1");
          const b = rect("b1");
          return {
            x: a.left + a.width / 2 + ((n % 2 ? 30 : -30) * a.width) / 180,
            y: a.bottom + (60 * a.width) / 180 + b.height / 2,
          };
        },
        move(p) {
          last = p;
          send("pointermove", p);
        },
      };
    });
    const samples = await sample(
      () => browser.execute(() => window.__perfBoard.press()),
      (i) =>
        browser.executeAsync((n, done) => {
          const offered = () => document.querySelector(".wr-board-glow.is-offer, .wr-board-spark");
          const p = window.__perfBoard.near(n);
          window
            .__perfTime(
              () => window.__perfBoard.move(p),
              () => offered(),
            )
            .then(
              (ms) => done({ ms }),
              (error) => done({ error: String(error) }),
            );
        }, i),
    );
    await browser.execute(() => window.__perfBoard.release());
    judge("PERF-07", "type", samples);
  });
});
