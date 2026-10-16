// Workspace and window journeys (WS in docs/qa/user-journeys.md). Runs on the
// seeded QA vault (e2e/qa/seed-vault.mjs).
import { strictEqual } from "node:assert/strict";

describe("Journeys: workspace and windows", function () {
  it("WS-05 the ¶ and PENSÉE are written, then the splash is gone and nothing stays applied", async function () {
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
});
