// Workspace and window journeys (WS in docs/qa/user-journeys.md). Runs on the
// seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";

/** The launch entrance's animations: name, state, time and delay. */
const entrance = () =>
  browser.execute(() =>
    document
      .getAnimations()
      .filter((a) => /^app-(splash|enter)/.test(a.animationName))
      .map((a) => ({
        name: a.animationName,
        state: a.playState,
        at: a.currentTime,
        delay: a.effect.getComputedTiming().delay,
      })),
  );

describe("Journeys: workspace and windows", function () {
  it("WS-05 the icon, its ¶ and PENSÉE come in, then the splash is gone and nothing stays applied", async function () {
    await $(".app-enter").waitForExist({ timeout: 10_000 });
    // The e2e window stays hidden, where WebKit holds the animation clock at
    // the first frame. The app's guard (3s) has to finish the entrance anyway
    // and the splash unmount, or it would sit over the app for good.
    await $(".app-splash").waitForExist({ timeout: 6_000, reverse: true });
    const style = await browser.execute(() => {
      const s = getComputedStyle(document.querySelector(".app-enter"));
      return {
        name: s.animationName,
        fill: s.animationFillMode,
        scale: s.scale,
        transform: s.transform,
      };
    });
    strictEqual(style.name, "app-enter");
    // `backwards`: once it ends no transform is left on the shell, so
    // fixed-position popovers inside it keep the viewport as their box.
    strictEqual(style.fill, "backwards");
    strictEqual(style.scale, "none");
    strictEqual(style.transform, "none");
  });

  it("WS-06 a key during the splash skips the writing and starts the reveal", async function () {
    // A fresh splash: reload, and catch it before the 3s guard.
    await browser.refresh();
    await $(".app-splash .app-splash-wordmark").waitForExist({ timeout: 10_000 });
    await browser.waitUntil(
      async () => (await entrance()).some((a) => a.name === "app-splash-write"),
      {
        timeout: 3_000,
        timeoutMsg: "the splash never started writing",
      },
    );

    await browser.execute(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })),
    );
    const after = await entrance();
    const writing = after.filter(
      (a) => a.name === "app-splash-pop" || a.name === "app-splash-write",
    );
    ok(writing.length > 0, "no writing animations to skip");
    ok(
      writing.every((a) => a.state === "finished"),
      `still writing: ${JSON.stringify(writing)}`,
    );
    const reveal = after.find((a) => a.name === "app-splash-out");
    ok(reveal && reveal.at >= reveal.delay, `the reveal didn't start: ${JSON.stringify(reveal)}`);

    await $(".app-splash").waitForExist({ timeout: 6_000, reverse: true });
  });
});
