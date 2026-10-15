// Workspace and window journeys (WS in docs/qa/user-journeys.md). Runs on the
// seeded QA vault (e2e/qa/seed-vault.mjs).
import { strictEqual } from "node:assert/strict";

const shellStyle = () =>
  browser.execute(() => {
    const s = getComputedStyle(document.querySelector(".app-enter"));
    return {
      name: s.animationName,
      duration: s.animationDuration,
      fill: s.animationFillMode,
      opacity: s.opacity,
      filter: s.filter,
      translate: s.translate,
    };
  });

describe("Journeys: workspace and windows", function () {
  it("WS-05 the window settles in once, then leaves nothing applied", async function () {
    await $(".app-enter").waitForExist({ timeout: 10_000 });
    // The e2e window stays hidden, where WebKit holds the animation clock at
    // the first frame (opacity 0). The app's guard has to finish the entrance
    // anyway, or every button in the window stays unclickable.
    await browser.waitUntil(async () => (await shellStyle()).opacity === "1", {
      timeout: 5_000,
      timeoutMsg: "the shell never settled: still see-through",
    });
    const style = await shellStyle();
    strictEqual(style.name, "app-enter");
    strictEqual(style.duration, "0.36s");
    // `backwards`: once it ends no filter or translate is left on the shell,
    // so fixed-position popovers inside it keep the viewport as their box.
    strictEqual(style.fill, "backwards");
    strictEqual(style.filter, "none");
    strictEqual(style.translate, "none");
  });
});
