// List journeys (ED-14 in docs/qa/user-journeys.md): the tree rail.
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";
import { pressCmd, typeInEditor, waitForTitle, workspaceRoot } from "./_helpers.js";

/** The front editor's rail paths and the accent's state. */
const railState = () =>
  browser.execute(() => {
    const editor = [...document.querySelectorAll(".cm-editor")].find((el) => el.offsetParent);
    const base = editor?.querySelector(".cm-list-rail");
    const accent = editor?.querySelector(".cm-list-rail-accent");
    return {
      base: base?.getAttribute("d") ?? "",
      accent: accent?.getAttribute("d") ?? "",
      accentShown: Boolean(accent?.classList.contains("is-visible")),
    };
  });

/** Move the pointer over the body of the visible list line holding `text`. */
const hoverLine = (text) =>
  browser.execute((needle) => {
    const line = [...document.querySelectorAll(".cm-line")].find(
      (el) => el.offsetParent && el.textContent.includes(needle),
    );
    const body = line?.querySelector(".cm-list-body");
    if (!line || !body) throw new Error(`no list line with ${needle}`);
    const box = body.getBoundingClientRect();
    const at = { bubbles: true, clientX: box.left + 4, clientY: box.top + box.height / 2 };
    line.dispatchEvent(new MouseEvent("mousemove", at));
  }, text);

describe("Journeys: lists", function () {
  before(async function () {
    await workspaceRoot();
  });

  it("ED-14 bullets hang on a rail; a nested one curves in; hover lights the path", async function () {
    // Seeded with `- one`, `- two`, `- [ ] a task`.
    await pressCmd("o");
    const input = await $("[cmdk-input]");
    await input.waitForExist({ timeout: 5_000 });
    await input.setValue("Welcome");
    const item = await $('//*[@cmdk-item][contains(., "Welcome")]');
    await item.waitForExist({ timeout: 5_000 });
    await item.click();
    await waitForTitle("Welcome");

    await browser.waitUntil(async () => (await railState()).base.startsWith("M"), {
      timeout: 5_000,
      timeoutMsg: "no rail under the seeded list",
    });
    ok(!(await railState()).base.includes("A"), "a flat list has no curves");

    // The seed ends in a newline, so the caret sits on the empty last line.
    await typeInEditor("  - nested");
    await browser.waitUntil(async () => (await railState()).base.includes("A"), {
      timeout: 5_000,
      timeoutMsg: "the nested item gets no curve from its parent",
    });

    await hoverLine("nested");
    let rail = await railState();
    await browser.waitUntil(async () => (rail = await railState()).accentShown, {
      timeout: 2_000,
      timeoutMsg: "hovering the nested item shows no accent",
    });
    ok(rail.accent.includes("A"), "the accent runs through the curve into the nested item");

    await hoverLine("one");
    await browser.waitUntil(async () => !(await railState()).accent.includes("A"), {
      timeout: 2_000,
      timeoutMsg: "the accent does not follow the pointer to the first item",
    });
    strictEqual((await railState()).base.includes("A"), true, "the grey lines stay");
  });
});
