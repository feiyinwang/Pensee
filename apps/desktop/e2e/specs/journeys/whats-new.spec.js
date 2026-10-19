// What's new (docs/qa/user-journeys.md § What's new — WN). wdio.conf.js seeds
// this file with `seedWhatsNew`: the changelog fixture's newest day is
// 2026-10-18 and the writer last saw 2026-10-17, so the card shows at launch.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { UPGRADE_FILE, writeRelease } from "../../qa/seed-vault.mjs";
import { pressCmd } from "./_helpers.js";

const PREFERENCES = join(
  homedir(),
  "Library/Application Support/com.pensee.app.e2e/preferences.json",
);

const card = () =>
  browser.execute(() => {
    const el = document.querySelector(".whats-new");
    if (!el) return null;
    const img = el.querySelector(".whats-new-art img");
    return {
      eyebrow: el.querySelector(".whats-new-eyebrow")?.textContent ?? "",
      title: el.querySelector(".whats-new-title")?.textContent ?? "",
      items: [...el.querySelectorAll(".whats-new-item")].map((li) => li.textContent ?? ""),
      more: el.querySelector(".whats-new-more")?.textContent ?? null,
      update: el.querySelector(".whats-new-update")?.textContent ?? null,
      updateDisabled: el.querySelector(".whats-new-update")?.disabled ?? null,
      // Not `error`: the WebDriver plugin reads an `error` key in a script's
      // result as the script failing.
      failure: el.querySelector(".whats-new-error")?.textContent ?? null,
      credit: el.querySelector("figcaption")?.textContent ?? "",
      painted: Boolean(img && img.complete && img.naturalWidth > 0),
      focused: el.contains(document.activeElement),
      rect: el.getBoundingClientRect().toJSON(),
      viewport: { w: innerWidth, h: innerHeight },
    };
  });

async function waitForCard(present = true) {
  await browser.waitUntil(async () => ((await card()) !== null) === present, {
    timeout: 10_000,
    timeoutMsg: present ? "the What's new card never showed" : "the What's new card stayed",
  });
}

const preference = (key) => JSON.parse(readFileSync(PREFERENCES, "utf8"))[key];

/** ⌘P → Show What's New, which reads the changelog and the release again. */
async function showFromPalette() {
  await pressCmd("p");
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue("Show What's New");
  await browser.keys(["Enter"]);
  await waitForCard();
}

async function waitForUpdateLabel(label) {
  await browser.waitUntil(async () => (await card())?.update === label, {
    timeout: 10_000,
    timeoutMsg: `the Update button never read "${label}"`,
  });
}

async function clickCardButton(label) {
  const button = await $(
    `//section[contains(@class,"whats-new")]//button[normalize-space(.)="${label}"]`,
  );
  await button.waitForExist({ timeout: 5_000 });
  await button.click();
}

describe("What's new", function () {
  this.timeout(60_000);

  it("WN-01 ★ an unseen changelog day shows once, in the corner, with its painting", async () => {
    await waitForCard();
    await browser.waitUntil(async () => (await card()).painted, {
      timeout: 5_000,
      timeoutMsg: "the painting never loaded",
    });
    const shown = await card();
    equal(shown.eyebrow, "What's new · 5 changes");
    equal(shown.title, "October 18");
    // First sentences only, three of five.
    deepEqual(shown.items, [
      "Pensée now welcomes you on first launch.",
      "Pensée can now be installed with one line: brew install --cask feiyinwang/tap/pensee, or the install script.",
      "Adding a paper from a link now brings in its PDF.",
    ]);
    equal(shown.more, "2 more");
    ok(/^[^,]+, .+/.test(shown.credit), `the painting is credited: ${shown.credit}`);
    // Bottom-right, and it never takes the writer's focus.
    ok(shown.viewport.w - shown.rect.right <= 24 && shown.viewport.h - shown.rect.bottom <= 24);
    equal(shown.focused, false);
  });

  it("WN-02 N more shows the rest of the day in place", async () => {
    await clickCardButton("2 more");
    const shown = await card();
    equal(shown.items.length, 5);
    equal(
      shown.items[4],
      "When Add to Projects finds a line that looks like a project you already have, it now asks first.",
    );
    equal(shown.more, null);
  });

  it("WN-03 Got it closes it and remembers the day", async () => {
    await clickCardButton("Got it");
    await waitForCard(false);
    await browser.waitUntil(() => preference("whatsNew.lastSeen") === "2026-10-18", {
      timeout: 5_000,
      timeoutMsg: "the day was not recorded as seen",
    });
  });

  it("WN-04 ⌘P → Show What's New brings the newest day back", async () => {
    await showFromPalette();
    equal((await card()).title, "October 18");
    await clickCardButton("Got it");
    await waitForCard(false);
  });
  it("WN-07 ★ a newer release shows Update and the version as the title", async () => {
    writeRelease("0.7.0");
    await showFromPalette();
    const shown = await card();
    equal(shown.title, "Pensée 0.7.0");
    equal(shown.eyebrow, "What's new · 5 changes");
    equal(shown.update, "Update");
    equal(shown.failure, null);
    // Got it and Read all are still there beside it.
    ok(
      await $(
        '//section[contains(@class,"whats-new")]//button[normalize-space(.)="Got it"]',
      ).isExisting(),
    );
    ok(
      await $(
        '//section[contains(@class,"whats-new")]//button[normalize-space(.)="Read all"]',
      ).isExisting(),
    );
    equal(shown.focused, false);
  });

  it("WN-08 a failed update shows its error in the card", async () => {
    writeFileSync(
      UPGRADE_FILE,
      "Couldn't copy the new Pensée into /Applications: Permission denied",
    );
    await clickCardButton("Update");
    await waitForUpdateLabel("Downloading…");
    equal((await card()).updateDisabled, true);
    await waitForUpdateLabel("Try again");
    equal(
      (await card()).failure,
      "Couldn't copy the new Pensée into /Applications: Permission denied",
    );
  });

  it("WN-09 Update downloads, then offers Restart Pensée", async () => {
    writeFileSync(UPGRADE_FILE, "ok");
    await clickCardButton("Try again");
    await waitForUpdateLabel("Downloading…");
    await waitForUpdateLabel("Restart Pensée");
    const shown = await card();
    equal(shown.failure, null);
    equal(shown.updateDisabled, false);
    // Not clicked: restarting would end the WebDriver session.
    await clickCardButton("Got it");
    await waitForCard(false);
    await browser.waitUntil(() => preference("whatsNew.releaseSeen") === "0.7.0", {
      timeout: 5_000,
      timeoutMsg: "the release was not recorded as seen",
    });
  });

  it("WN-10 a release that isn't newer shows no Update", async () => {
    writeRelease("0.6.0");
    await showFromPalette();
    const shown = await card();
    equal(shown.title, "October 18");
    equal(shown.update, null);
    await clickCardButton("Got it");
    await waitForCard(false);
  });
});
