// Import journeys (IMP in docs/qa/user-journeys.md).
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";
import { invoke, workspaceRoot } from "./_helpers.js";

const SCREENSHOT = process.env.PENSEE_QA_SHOTS
  ? `${process.env.PENSEE_QA_SHOTS}/imp-03-full-disk-access-guide.png`
  : null;

/** Pensée → Preferences… in the menu bar (⌘,): the menu sends this event. */
async function openSettings() {
  const sent = await invoke("plugin:event|emit", { event: "menu:open-preferences", payload: null });
  ok(sent.ok, `opening Preferences failed: ${sent.error}`);
  await $("//h1[normalize-space(.)='Preferences']").waitForExist({ timeout: 5_000 });
}

/** Where each marker sits against what it points at, on the picture's last
 *  frame (the hidden e2e window holds animations at their first, and a
 *  finished colour animation still reads back as oklab). */
const guideLayout = () =>
  browser.execute(() => {
    const guide = document.querySelector(".fda-guide");
    // Cancelled, each part shows its resting style: the last frame.
    for (const animation of guide.getAnimations({ subtree: true })) animation.cancel();
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const name = document.querySelector(".fda-figure-row--pensee .fda-figure-name");
    const range = document.createRange();
    range.selectNodeContents(name);
    const nameText = range.getBoundingClientRect();
    const plus = rect(".fda-figure-plus");
    const toggle = rect(".fda-figure-switch--pensee");
    const cursor = rect(".fda-figure-cursor");
    const markers = [1, 2, 3].map((n) => rect(`.fda-figure-marker[data-step="${n}"]`));
    const style = getComputedStyle(document.querySelector(".fda-figure-switch--pensee"));
    const on = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-macos-switch-on")
      .trim();
    const probe = document.createElement("i");
    probe.style.color = on;
    document.body.append(probe);
    const onColour = getComputedStyle(probe).color;
    probe.remove();
    return {
      title: guide.querySelector("h2").textContent,
      steps: [...guide.querySelectorAll(".fda-guide-step")].map((li) => li.textContent),
      buttons: [...guide.querySelectorAll(".fda-guide-actions button")].map((b) =>
        b.textContent.trim(),
      ),
      plus: { left: plus.left, right: plus.right, top: plus.top },
      nameEnd: nameText.right,
      toggle: { left: toggle.left, top: toggle.top, bottom: toggle.bottom },
      cursorTip: { x: cursor.left + 1, y: cursor.top + 1 },
      markers: markers.map((m) => ({
        left: m.left,
        right: m.right,
        top: m.top,
        bottom: m.bottom,
        midX: (m.left + m.right) / 2,
        midY: (m.top + m.bottom) / 2,
      })),
      switchColour: style.backgroundColor,
      onColour,
      focusInGuide: guide.contains(document.activeElement),
    };
  });

describe("Import journeys", function () {
  before(async function () {
    await workspaceRoot();
  });

  after(async function () {
    await invoke("set_setting", { key: "apple-books.sync", value: false, scope: "workspace" });
  });

  it("IMP-03 Import Highlights without Full Disk Access opens the guide, never the macOS prompt", async function () {
    const access = await invoke("has_full_disk_access");
    ok(access.ok, `has_full_disk_access failed: ${access.error}`);
    // The guide is for a Mac where Pensée lacks it; with it, the import runs.
    if (access.value) this.skip();

    await openSettings();
    const toggle = await $(
      "//*[normalize-space(text())='Import Highlights']/ancestor::*[.//button[@role='switch']][1]//button[@role='switch']",
    );
    await toggle.waitForExist({ timeout: 5_000 });
    await toggle.click();

    const guide = await $(".fda-guide");
    await guide.waitForExist({ timeout: 10_000 });
    await browser.execute(() => {
      const style = document.createElement("style");
      style.textContent = "*{transition:none!important}";
      document.head.append(style);
    });
    const layout = await guideLayout();
    console.log("DEBUG IMP-03", JSON.stringify(layout));

    strictEqual(layout.title, "Let Pensée read Apple Books");
    strictEqual(layout.steps.length, 3);
    ok(layout.buttons[0].startsWith("Not now"), `first button: ${layout.buttons[0]}`);
    ok(layout.buttons[1].startsWith("Open Settings"), `primary: ${layout.buttons[1]}`);
    ok(!layout.focusInGuide, "the guide took focus from the note");

    const [one, two, three] = layout.markers;
    // 1 over +, pointing down at it.
    ok(
      one.midX >= layout.plus.left && one.midX <= layout.plus.right,
      `marker 1 (${one.midX}) is not over + (${layout.plus.left}–${layout.plus.right})`,
    );
    ok(
      one.bottom <= layout.plus.top && layout.plus.top - one.bottom < 12,
      "marker 1 is not just above +",
    );
    // 2 just after Pensée's name.
    ok(
      two.left > layout.nameEnd && two.left - layout.nameEnd < 8,
      "marker 2 is not just after Pensée",
    );
    // 3 just before Pensée's switch, level with it.
    ok(
      three.right <= layout.toggle.left && layout.toggle.left - three.right < 8,
      "marker 3 is not just before the switch",
    );
    ok(
      three.midY > layout.toggle.top && three.midY < layout.toggle.bottom,
      "marker 3 is not level with the switch",
    );
    // The cursor rests on the switch, and the switch is on.
    ok(
      layout.cursorTip.x >= layout.toggle.left && layout.cursorTip.y >= layout.toggle.top,
      "the cursor does not rest on Pensée's switch",
    );
    strictEqual(layout.switchColour, layout.onColour, "Pensée's switch is not on");

    if (SCREENSHOT) await browser.saveScreenshot(SCREENSHOT);

    // Esc closes it once it has focus.
    await browser.execute(() => {
      const card = document.querySelector(".fda-guide");
      card.focus();
      card.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await browser.waitUntil(async () => !(await $(".fda-guide").isExisting()), {
      timeout: 5_000,
      timeoutMsg: "Esc did not close the guide",
    });
  });
});
