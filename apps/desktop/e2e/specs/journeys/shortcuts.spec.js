// Obsidian's keys (SPECs/obsidian-shortcuts-spec.md): the journeys for keys
// that took Obsidian's meaning, beyond search and find (palette, editor).
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok } from "node:assert/strict";
import {
  activeTitle,
  caretAfter,
  invoke,
  pressCmd,
  pressKey,
  typeInEditor,
  waitForTitle,
  workspaceRoot,
} from "./_helpers.js";

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

async function readFile(path) {
  const result = await invoke("read_file", { path });
  ok(result.ok, `read_file ${path} failed: ${result.error}`);
  return result.value.content;
}

/** Wait until `path` on disk satisfies `test` (autosave lands within a second). */
async function waitForContent(path, test, what) {
  await browser.waitUntil(async () => test(await readFile(path)), {
    timeout: 5_000,
    timeoutMsg: `${path} never ${what}`,
  });
}

describe("Journeys: Obsidian shortcuts", function () {
  let root;

  before(async function () {
    root = await workspaceRoot();
  });

  it("ED-18 ⌘L makes a line a task, then ticks and unticks it", async function () {
    const path = `${root}/Welcome.md`;
    await openViaPalette("Welcome");
    await typeInEditor("Plain line");
    await pressCmd("l", { inFocus: true });
    await waitForContent(path, (text) => text.includes("- [ ] Plain line"), "made the task");
    await pressCmd("l", { inFocus: true });
    await waitForContent(path, (text) => text.includes("- [x] Plain line"), "ticked it");
    await pressCmd("l", { inFocus: true });
    await waitForContent(path, (text) => text.includes("- [ ] Plain line"), "unticked it");
  });

  it("ED-19 ⌘D deletes the caret's line", async function () {
    const path = `${root}/Welcome.md`;
    await typeInEditor("");
    await pressCmd("d", { inFocus: true });
    await waitForContent(path, (text) => !text.includes("Plain line"), "lost the line");
    ok((await readFile(path)).includes("- [ ] a task"), "the line above is kept");
  });

  it("LNK-09 ⌥Enter on a [[link]] opens its page, as a click does", async function () {
    await openViaPalette("On writing");
    // `See [[Welcome]].`: the caret just before the link counts as on it.
    await caretAfter("See ");
    await pressKey("Enter", { alt: true, inFocus: true });
    await waitForTitle("Welcome");
  });

  it("TAB-04 ⌥⌘← and ⌥⌘→ go back and forward, with the caret in a note", async function () {
    await openViaPalette("Welcome");
    await openViaPalette("On writing");
    await typeInEditor("");
    await pressCmd("ArrowLeft", { alt: true, inFocus: true });
    await waitForTitle("Welcome");
    await typeInEditor("");
    await pressCmd("ArrowRight", { alt: true, inFocus: true });
    await waitForTitle("On writing");
  });

  it("TAB-08 ⌘⇧T brings back the tab ⌘W closed", async function () {
    await openViaPalette("Welcome");
    await pressCmd("w");
    await browser.waitUntil(async () => (await activeTitle()) !== "Welcome", {
      timeout: 5_000,
      timeoutMsg: "⌘W left Welcome in front",
    });
    await pressCmd("t", { shift: true });
    await waitForTitle("Welcome");
  });
});
