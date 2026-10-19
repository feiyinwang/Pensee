// In-context tips (docs/qa/user-journeys.md § In-context tips — TIP).
// wdio.conf.js seeds this file with `seedTips`: the QA vault with tips on and
// no tip shown yet. Every other journey file runs with tips off, so a tip
// never lands in the middle of its checks.
//
// The QA vault already holds `^ai-s-` and `^ai-e-` lines (Notes/Pen.md), so
// the launch search marks Answer and Connect done; it has two books and two
// projects, so the Library and Projects tips are the "with items" ones.
import { equal, ok } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pressCmd, pressKey, waitForTitle, workspaceRoot } from "./_helpers.js";

const PREFERENCES = join(
  homedir(),
  "Library/Application Support/com.pensee.app.e2e/preferences.json",
);

const prefs = () => (existsSync(PREFERENCES) ? JSON.parse(readFileSync(PREFERENCES, "utf8")) : {});

const tipLine = (id) =>
  browser.execute((tip) => document.querySelector(`[data-tip="${tip}"]`)?.textContent ?? null, id);

const pillText = () =>
  browser.execute(() => document.querySelector(".guide-pill")?.textContent ?? null);

async function waitForTip(id, present = true, timeout = 8_000) {
  await browser.waitUntil(async () => ((await tipLine(id)) !== null) === present, {
    timeout,
    timeoutMsg: present ? `the ${id} tip never showed` : `the ${id} tip stayed`,
  });
}

/** Opens a note through the sidebar's search, as board.spec.js does. */
async function openNote(name) {
  await $("[data-sidebar-surface-content] [data-sidebar-search-button]").click();
  await $("[cmdk-input]").waitForExist({ timeout: 5_000 });
  await browser.execute((value) => {
    const field = document.querySelector("[cmdk-input]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);
  const row = await $(`//*[@cmdk-item][contains(., "${name}")]`);
  await row.waitForExist({ timeout: 5_000 });
  await row.click();
  await waitForTitle(name);
}

/** Go to a Space with the go key (⌘G, then its letter). */
async function goTo(letter) {
  await pressKey("g", { meta: true, code: "KeyG" });
  await pressKey(letter, { code: `Key${letter.toUpperCase()}` });
}

describe("In-context tips", function () {
  this.timeout(90_000);

  before(async () => {
    await workspaceRoot();
  });

  it("TIP-01 ★ the launch search marks features already used as done", async () => {
    await browser.waitUntil(
      () => prefs()["tips.pen-answer.done"] === true && prefs()["tips.pen-connect.done"] === true,
      { timeout: 15_000, timeoutMsg: `not marked done: ${JSON.stringify(prefs())}` },
    );
    // Nothing the vault doesn't show is marked.
    equal(prefs()["tips.calendar-period.done"], undefined);
  });

  it("TIP-02 the calendar's tip shows under the grid after the pause, with Not now and no pill", async () => {
    await pressCmd("]");
    const started = Date.now();
    await waitForTip("calendar-period");
    ok(Date.now() - started >= 500, "it waited for the pause");
    ok(
      (await tipLine("calendar-period")).includes("Click a week, month or year for its note."),
      await tipLine("calendar-period"),
    );
    ok((await tipLine("calendar-period")).includes("Not now"));
    equal(await pillText(), null, "a move with no key has no pill");
    equal(prefs()["tips.calendar-period.shown"], 1);
  });

  it("TIP-03 doing the move says what happened, then the tip fades and never comes back", async () => {
    const week = await $(
      '//aside[@aria-label="Calendar"]//*[@data-present]//button[contains(@class,"calendar-panel-cell")][starts-with(normalize-space(.),"W")]',
    );
    await week.waitForClickable({ timeout: 3_000 });
    await week.click();
    await browser.waitUntil(
      async () => (await tipLine("calendar-period"))?.includes("has its own note"),
      { timeout: 3_000, timeoutMsg: "no done line" },
    );
    equal(prefs()["tips.calendar-period.done"], true);
    await waitForTip("calendar-period", false, 5_000);
    // Closing and opening the calendar again: no tip.
    await pressCmd("]");
    await pressCmd("]");
    await browser.pause(1_500);
    equal(await tipLine("calendar-period"), null);
    await pressCmd("]");
  });

  it("TIP-04 Esc is Not now: the Library tip comes back once more, then never", async () => {
    for (let showing = 1; showing <= 2; showing += 1) {
      await goTo("l");
      await waitForTip("library-open");
      ok((await tipLine("library-open")).includes("Open a book: it reads beside its note."));
      await pressKey("Escape");
      await waitForTip("library-open", false, 2_000);
      equal(prefs()["tips.library-open.shown"], showing);
      await goTo("f");
    }
    await goTo("l");
    await browser.pause(1_500);
    equal(await tipLine("library-open"), null, "a third arrival shows nothing");
  });

  it("TIP-05 selecting three lines offers Organize: the words after the selection, the keys in the pill", async () => {
    await openNote("Welcome");
    await $(".cm-content").click();
    await pressCmd("a", { inFocus: true });
    await browser.waitUntil(async () => (await pillText())?.includes("Organize"), {
      timeout: 8_000,
      timeoutMsg: `no Organize pill (${await pillText()})`,
    });
    const keys = await browser.execute(() =>
      [...document.querySelectorAll(".guide-pill kbd")].map((k) => k.textContent),
    );
    equal(keys.join(" "), "⌘ . #");
    const words = await browser.execute(() => document.querySelector(".cm-tip")?.textContent);
    ok(words?.includes("Sort these into topics"), `the line after the selection: ${words}`);
    await $('//div[contains(@class,"guide-pill")]//button[normalize-space(.)="Not now"]').click();
    await browser.waitUntil(async () => (await pillText()) === null, { timeout: 2_000 });
  });
});
