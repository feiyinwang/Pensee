// Command palette journeys (PAL in docs/qa/user-journeys.md). Runs on the
// seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";
import { pressCmd } from "./_helpers.js";

describe("Journeys: command palette", function () {
  before(async function () {
    // ⌘P does nothing until the workspace has loaded.
    await $("[data-sidebar-surface-content] [data-sidebar-search-button]").waitForExist({
      timeout: 10_000,
    });
  });

  it("PAL-05 ⌘P reads 'Search notes and commands…' and nothing is in all caps", async function () {
    await pressCmd("p");
    const input = await $("[cmdk-input]");
    await input.waitForExist({ timeout: 5_000 });
    await $("[cmdk-group-heading]").waitForExist({ timeout: 5_000 });
    strictEqual(await input.getAttribute("placeholder"), "Search notes and commands…");

    // Every element on screen whose text the CSS forces to capitals, palette
    // and sidebar alike. The user's rule: sentence case at most, nowhere caps.
    const capped = await browser.execute(() =>
      [...document.querySelectorAll("body *")]
        .filter((el) => el.offsetParent !== null && el.textContent.trim())
        .filter((el) => /uppercase|small-caps/.test(getComputedStyle(el).textTransform + getComputedStyle(el).fontVariantCaps))
        .map((el) => el.textContent.trim().slice(0, 40)),
    );
    strictEqual(capped.length, 0, `set in caps: ${capped.join(" | ")}`);

    const headings = await browser.execute(() =>
      [...document.querySelectorAll("[cmdk-group-heading]")].map((el) => el.innerText.trim()),
    );
    ok(headings.includes("Suggested"), `headings: ${headings.join(", ")}`);
    await browser.keys("Escape");
    await input.waitForExist({ timeout: 5_000, reverse: true });
  });
});
