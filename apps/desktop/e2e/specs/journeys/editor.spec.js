// Editor journeys (ED in docs/qa/user-journeys.md) beyond the smoke set.
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";
import { mouseClick, pressCmd, waitForTitle, workspaceRoot } from "./_helpers.js";

/** Open a note by name through ⌘O, the way PAL-01 does. */
async function openViaPalette(name) {
  await pressCmd("o");
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue(name);
  const item = await $(`//*[@cmdk-item][contains(., "${name}")]`);
  await item.waitForExist({ timeout: 5_000 });
  await item.click();
  await waitForTitle(name);
}

/** The front note's title and properties toggle boxes, and the toggle's state. */
const headerLayout = () =>
  browser.execute(() => {
    const title = [...document.querySelectorAll("[data-page-title]")].find((el) => el.offsetParent);
    const toggle = [...document.querySelectorAll(".page-header-toggle")].find(
      (el) => el.offsetParent,
    );
    if (!title || !toggle) return null;
    const t = title.getBoundingClientRect();
    const g = toggle.getBoundingClientRect();
    const panelId = toggle.getAttribute("aria-controls");
    return {
      text: toggle.textContent.trim(),
      titleLeft: t.left,
      titleBottom: t.bottom,
      toggleLeft: g.left,
      toggleTop: g.top,
      expanded: toggle.getAttribute("aria-expanded"),
      panelShown: Boolean(panelId && document.getElementById(panelId)),
    };
  });

describe("Journeys: editor", function () {
  before(async function () {
    await workspaceRoot();
  });

  it("ED-03 N properties › sits under the title at its left edge, and opens and folds", async function () {
    // Seeded with Type and Status.
    await openViaPalette("Old idea");

    await $(".page-header-toggle").waitForExist({ timeout: 5_000 });
    let layout = await headerLayout();
    ok(layout, "the title and its properties toggle show");
    strictEqual(layout.text, "2 properties");
    ok(
      layout.toggleTop >= layout.titleBottom - 1,
      `toggle under the title (toggle top ${layout.toggleTop}, title bottom ${layout.titleBottom})`,
    );
    ok(
      Math.abs(layout.toggleLeft - layout.titleLeft) <= 1,
      `toggle left-aligned with the title (${layout.toggleLeft} vs ${layout.titleLeft})`,
    );
    strictEqual(layout.expanded, "false");
    strictEqual(layout.panelShown, false, "properties folded by default");

    await mouseClick(await $(".page-header-toggle"));
    await browser.waitUntil(async () => (await headerLayout())?.panelShown === true, {
      timeout: 3_000,
      timeoutMsg: "clicking the toggle opens the properties",
    });
    strictEqual((await headerLayout()).expanded, "true");

    await mouseClick(await $(".page-header-toggle"));
    await browser.waitUntil(async () => (await headerLayout())?.panelShown === false, {
      timeout: 3_000,
      timeoutMsg: "clicking the toggle again folds the properties",
    });
    layout = await headerLayout();
    strictEqual(layout.expanded, "false");
  });
});
