// Import journeys (IMP in docs/qa/user-journeys.md).
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { execSync } from "node:child_process";
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
    const figure = rect(".fda-figure");
    // Places in the screenshot (its own pixels), where they are on screen now.
    const image = document.querySelector(".fda-shot-image");
    const shot = image.getBoundingClientRect();
    const scale = shot.width / image.naturalWidth;
    const inShot = (left, top, right, bottom) => ({
      left: shot.left + left * scale,
      right: shot.left + right * scale,
      top: shot.top + top * scale,
      bottom: shot.top + bottom * scale,
    });
    const shotSwitch = inShot(1212, 1831, 1278, 1860);
    const plus = inShot(473, 1969, 488, 1983);
    const name = inShot(535, 1828, 662, 1860);
    const toggle = rect(".fda-figure-switch");
    const cursor = rect(".fda-figure-cursor");
    const markers = [1, 2, 3].map((n) => rect(`.fda-figure-marker[data-step="${n}"]`));
    const style = getComputedStyle(document.querySelector(".fda-figure-switch"));
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
      private: guide.querySelector(".fda-guide-private").textContent,
      steps: [...guide.querySelectorAll(".fda-guide-step")].map((li) => li.textContent),
      buttons: [...guide.querySelectorAll(".fda-guide-actions button")].map((b) =>
        b.textContent.trim(),
      ),
      imageLoaded: image.complete && image.naturalWidth === 1314,
      figure: { left: figure.left, right: figure.right, top: figure.top, bottom: figure.bottom },
      plus,
      name,
      shotSwitch,
      // Pensée's row is drawn back over the screenshot once it is added.
      penseeShown: getComputedStyle(document.querySelector('[data-slice="pensee"]')).opacity,
      toggle: { left: toggle.left, right: toggle.right, top: toggle.top, bottom: toggle.bottom },
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
    ok(layout.private.includes("uploads nothing"), `privacy line: ${layout.private}`);
    strictEqual(layout.steps.length, 3);
    ok(layout.buttons[0].startsWith("Not now"), `first button: ${layout.buttons[0]}`);
    ok(layout.buttons[1].startsWith("Open Settings"), `primary: ${layout.buttons[1]}`);
    ok(!layout.focusInGuide, "the guide took focus from the note");

    ok(layout.imageLoaded, "the System Settings screenshot did not load");
    const inside = (box) =>
      box.left >= layout.figure.left &&
      box.right <= layout.figure.right &&
      box.top >= layout.figure.top &&
      box.bottom <= layout.figure.bottom;
    ok(inside(layout.shotSwitch) && inside(layout.plus), "Pensée and + are not in view");
    // The drawn switch covers the screenshot's own, within a pixel.
    for (const side of ["left", "right", "top", "bottom"]) {
      ok(
        Math.abs(layout.toggle[side] - layout.shotSwitch[side]) <= 1,
        `the switch's ${side} is ${layout.toggle[side]}, the screenshot's ${layout.shotSwitch[side]}`,
      );
    }
    ok(inside(layout.name), "Pensée's row is not in view");
    strictEqual(layout.penseeShown, "1", "Pensée did not join the list");
    const [one, two, three] = layout.markers;
    // Each marker's arrow (4px) reaches to within 3px of what it names, level with it.
    const pointsAt = (marker, box, name, from) => {
      const gap = from === "left" ? box.left - marker.right : marker.left - box.right;
      ok(gap >= 4 && gap <= 7, `marker for ${name} is ${gap}px from it`);
      ok(
        marker.midY > box.top && marker.midY < box.bottom,
        `marker for ${name} is not level with it`,
      );
    };
    pointsAt(one, layout.plus, "+", "left");
    pointsAt(two, layout.name, "Pensée", "right");
    pointsAt(three, layout.toggle, "Pensée's switch", "left");
    // The cursor rests on the switch, and the switch is on.
    ok(
      layout.cursorTip.x >= layout.toggle.left &&
        layout.cursorTip.x <= layout.toggle.right &&
        layout.cursorTip.y >= layout.toggle.top &&
        layout.cursorTip.y <= layout.toggle.bottom,
      "the cursor does not rest on Pensée's switch",
    );
    strictEqual(layout.switchColour, layout.onColour, "Pensée's switch is not on");

    if (SCREENSHOT) await browser.saveScreenshot(SCREENSHOT);

    // Opt-in, since it brings System Settings to the front: Open Settings
    // really opens it (the opener allows the x-apple.systempreferences link).
    if (process.env.PENSEE_QA_OPEN_SETTINGS) {
      const running = () => {
        try {
          execSync('pgrep -x "System Settings"');
          return true;
        } catch {
          return false;
        }
      };
      const wasRunning = running();
      const primary = await $(".fda-guide-button--primary");
      await primary.click();
      await browser.waitUntil(async () => running(), {
        timeout: 10_000,
        timeoutMsg: "Open Settings did not open System Settings",
      });
      if (!wasRunning) execSync('pkill -x "System Settings"');
    }

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
