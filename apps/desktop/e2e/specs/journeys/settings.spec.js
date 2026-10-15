// Settings journeys (SET in docs/qa/user-journeys.md) beyond the smoke set.
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";
import { invoke, pressCmd, waitForTitle, workspaceRoot } from "./_helpers.js";

/** Open a note by name through ⌘F, the way PAL-01 does. */
async function openViaPalette(name) {
  await pressCmd("f");
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue(name);
  const item = await $(`//*[@cmdk-item][contains(., "${name}")]`);
  await item.waitForExist({ timeout: 5_000 });
  await item.click();
  await waitForTitle(name);
}

/** Which width preset is checked, and the front editor's column cap in px. */
const widthState = () =>
  browser.execute(() => {
    const checked = document.querySelector('[aria-label="Page width"] [aria-checked="true"]');
    const content = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
    return {
      checked: checked?.getAttribute("aria-label") ?? null,
      maxWidth: content ? parseFloat(getComputedStyle(content).maxWidth) : null,
    };
  });

async function pickPreset(label) {
  const button = await $(`[aria-label="Page width"] [aria-label="${label}"]`);
  await button.waitForExist({ timeout: 5_000 });
  await button.click();
  await browser.waitUntil(async () => (await widthState()).checked === label, {
    timeout: 5_000,
    timeoutMsg: `${label} never became the checked width`,
  });
}

describe("Settings journeys", function () {
  before(async function () {
    await workspaceRoot();
  });

  after(async function () {
    await invoke("set_setting", { key: "editor.content-width", value: 660, scope: "global" });
  });

  it("SET-06 the status bar presets set the page width", async function () {
    await openViaPalette("Welcome");
    const readable = await widthState();
    strictEqual(readable.checked, "Readable", "a fresh vault starts on Readable");

    await pickPreset("Wide");
    const wide = await widthState();
    ok(wide.maxWidth > readable.maxWidth, `Wide (${wide.maxWidth}) is not wider than Readable`);
    const stored = await invoke("get_setting", { key: "editor.content-width" });
    strictEqual(stored.value, 960, "Wide is saved as the content width");

    await pickPreset("Full width");
    ok((await widthState()).maxWidth > wide.maxWidth, "Full width is not wider than Wide");

    await pickPreset("Readable");
    strictEqual((await widthState()).maxWidth, readable.maxWidth, "Readable restores the column");
  });
});
