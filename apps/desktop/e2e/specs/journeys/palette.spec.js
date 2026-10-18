// Command palette journeys (PAL in docs/qa/user-journeys.md). Runs on the
// seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";
import { pressCmd } from "./_helpers.js";

describe("Journeys: command palette", function () {
  before(async function () {
    // ⌘O does nothing until the workspace has loaded.
    await $("[data-sidebar-surface-content] [data-sidebar-search-button]").waitForExist({
      timeout: 10_000,
    });
  });

  it("PAL-05 ⌘P lists commands only, each with its key, and nothing is in all caps", async function () {
    await pressCmd("p");
    const input = await $("[cmdk-input]");
    await input.waitForExist({ timeout: 5_000 });
    await $("[cmdk-group-heading]").waitForExist({ timeout: 5_000 });
    strictEqual(await input.getAttribute("placeholder"), "Select a command…");

    // Every element on screen whose text the CSS forces to capitals, palette
    // and sidebar alike. The user's rule: sentence case at most, nowhere caps.
    const capped = await browser.execute(() =>
      [...document.querySelectorAll("body *")]
        .filter((el) => el.offsetParent !== null && el.textContent.trim())
        .filter((el) =>
          /uppercase|small-caps/.test(
            getComputedStyle(el).textTransform + getComputedStyle(el).fontVariantCaps,
          ),
        )
        .map((el) => el.textContent.trim().slice(0, 40)),
    );
    strictEqual(capped.length, 0, `set in caps: ${capped.join(" | ")}`);

    const { headings, projects, files } = await browser.execute(() => ({
      headings: [...document.querySelectorAll("[cmdk-group-heading]")].map((el) =>
        el.innerText.trim(),
      ),
      projects:
        document
          .querySelector('[cmdk-item][data-value="go-to-projects"]')
          ?.textContent.replace(/\s+/g, "") ?? null,
      // Commands only: no note rows (their values are paths).
      files: [...document.querySelectorAll("[cmdk-item]")].filter((el) =>
        (el.getAttribute("data-value") ?? "").includes("/"),
      ).length,
    }));
    ok(headings.includes("Commands"), `headings: ${headings.join(", ")}`);
    strictEqual(projects, "GotoProjects⌘GP", "Go to Projects shows ⌘ G P");
    strictEqual(files, 0, "⌘P lists no notes");
    await browser.keys("Escape");
    await input.waitForExist({ timeout: 5_000, reverse: true });
  });

  it("PAL-06 ⌘O and ⌘⇧F find notes only, as Obsidian's quick switcher", async function () {
    for (const [key, shift] of [
      ["o", false],
      ["f", true],
    ]) {
      await pressCmd(key, { shift });
      const input = await $("[cmdk-input]");
      await input.waitForExist({
        timeout: 5_000,
        timeoutMsg: `⌘${shift ? "⇧" : ""}${key.toUpperCase()} opened no search`,
      });
      strictEqual(await input.getAttribute("placeholder"), "Find a note…");
      await input.setValue("Settings");
      await browser.pause(400);
      strictEqual(
        await $('[cmdk-item][data-value="open-settings"]').isExisting(),
        false,
        "a command showed in ⌘O",
      );
      await browser.keys("Escape");
      await input.waitForExist({ timeout: 5_000, reverse: true });
    }
  });
});
