// What's new (docs/qa/user-journeys.md § What's new — WN). wdio.conf.js seeds
// this file with `seedWhatsNew`: the changelog fixture has 2026-10-17 and
// 2026-10-18 and the writer last saw 2026-10-16, so the card shows both at launch.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

async function clickCardButton(label) {
  const button = await $(
    `//section[contains(@class,"whats-new")]//button[normalize-space(.)="${label}"]`,
  );
  await button.waitForExist({ timeout: 5_000 });
  await button.click();
}

describe("What's new", function () {
  this.timeout(60_000);

  it("WN-01 ★ the days since the writer last looked show once, in the corner, with a painting", async () => {
    await waitForCard();
    await browser.waitUntil(async () => (await card()).painted, {
      timeout: 5_000,
      timeoutMsg: "the painting never loaded",
    });
    const shown = await card();
    // Both unseen days in one card, newest first.
    equal(shown.eyebrow, "What's new · 6 changes");
    equal(shown.title, "October 17–18");
    // First sentences only, three of six.
    deepEqual(shown.items, [
      "Pensée now welcomes you on first launch.",
      "Pensée can now be installed with one line: brew install --cask feiyinwang/tap/pensee, or the install script.",
      "Adding a paper from a link now brings in its PDF.",
    ]);
    equal(shown.more, "3 more");
    ok(/^[^,]+, .+/.test(shown.credit), `the painting is credited: ${shown.credit}`);
    // Bottom-right, and it never takes the writer's focus.
    ok(shown.viewport.w - shown.rect.right <= 24 && shown.viewport.h - shown.rect.bottom <= 24);
    equal(shown.focused, false);
  });

  it("WN-02 N more shows the rest in place, the older day's last", async () => {
    await clickCardButton("3 more");
    const shown = await card();
    equal(shown.items.length, 6);
    equal(
      shown.items[4],
      "When Add to Projects finds a line that looks like a project you already have, it now asks first.",
    );
    equal(shown.items[5], "⌘↓ now takes you to the very bottom of a note and ⌘↑ to the very top.");
    equal(shown.more, null);
  });

  it("WN-03 Got it closes it and remembers the newest day", async () => {
    await clickCardButton("Got it");
    await waitForCard(false);
    await browser.waitUntil(
      () => JSON.parse(readFileSync(PREFERENCES, "utf8"))["whatsNew.lastSeen"] === "2026-10-18",
      { timeout: 5_000, timeoutMsg: "the day was not recorded as seen" },
    );
  });

  it("WN-04 ⌘P → Show What's New brings the newest day back", async () => {
    await pressCmd("p");
    const input = await $("[cmdk-input]");
    await input.waitForExist({ timeout: 5_000 });
    await input.setValue("Show What's New");
    await browser.keys(["Enter"]);
    await waitForCard();
    equal((await card()).title, "October 18");
    await clickCardButton("Got it");
    await waitForCard(false);
  });
});
