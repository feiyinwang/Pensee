// Onboarding (docs/qa/user-journeys.md § Onboarding — ONB): a first run with
// no folder open. wdio.conf.js seeds this file with `seedFirstRun`: the QA
// vault exists and is listed as an Obsidian vault, but nothing is open yet.
import { equal, ok } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pressCmd, workspaceRoot } from "./_helpers.js";

const APP_DATA = join(homedir(), "Library/Application Support/com.pensee.app.e2e");

const title = () =>
  browser.execute(() => document.querySelector(".onb-title")?.textContent ?? null);

async function waitForTitle(text) {
  await browser.waitUntil(async () => (await title()) === text, {
    timeout: 15_000,
    timeoutMsg: `onboarding never showed "${text}" (showed "${await title()}")`,
  });
}

async function clickButton(label) {
  const button = await $(`//button[contains(normalize-space(.), "${label}")]`);
  await button.waitForExist({ timeout: 10_000 });
  await button.click();
}

const guideText = () =>
  browser.execute(() => document.querySelector(".onb-guide")?.textContent ?? null);

describe("Onboarding", function () {
  this.timeout(120_000);

  it("ONB-01 ★ a first launch asks for the notes; the Obsidian vault opens with ↵", async () => {
    await waitForTitle("Open your second brain.");
    const vault = await $('//button[contains(., "Open qa-vault")]');
    await vault.waitForExist({ timeout: 10_000 });
    ok(/\d+ notes/.test(await vault.getText()), "the vault's button shows its note count");
    // The likely choice is focused, so ↵ runs it.
    equal(
      await browser.execute(() => document.activeElement?.textContent?.includes("Open qa-vault")),
      true,
    );
    await browser.keys(["Enter"]);
    await waitForTitle("Which AI should Pensée use?");
    ok((await workspaceRoot())?.endsWith("qa-vault"), "the vault is the open folder");
  });

  it("ONB-02 the AI screen offers Claude Code, and Skip for now goes on", async () => {
    const choices = await browser.execute(() =>
      [...document.querySelectorAll(".onb-choice")].map((b) => b.textContent ?? ""),
    );
    ok(
      choices.some((c) => /Use Claude Code|Sign in to Claude Code|Check again/.test(c)),
      `Claude Code is offered: ${choices.join(" | ")}`,
    );
    await clickButton("Other options");
    ok(String(await browser.execute(() => document.body.textContent)).includes("Coming soon"));
    await clickButton("Skip for now");
    await waitForTitle("Pick something to try Pensée on.");
  });

  it("ONB-03 Just write opens a practice note in Pensée samples, with the guide", async () => {
    await clickButton("Just write");
    const note = join(APP_DATA, "qa-vault/Pensée samples/Why do we forget most of what we read.md");
    await browser.waitUntil(() => existsSync(note), { timeout: 10_000, timeoutMsg: "no note" });
    await browser.waitUntil(async () => (await guideText())?.includes("1 of 2"), {
      timeout: 10_000,
      timeoutMsg: "no guide",
    });
    ok((await guideText()).includes("for Answer"), await guideText());
    await clickButton("Skip");
    await waitForTitle("There's more when you need it.");
  });

  it("ONB-04 the carousel moves with → and Start writing ends onboarding", async () => {
    const caption = () =>
      browser.execute(() => document.querySelector(".onb-cr-text b")?.textContent ?? null);
    equal(await caption(), "See every tab at once");
    await browser.keys(["ArrowRight"]);
    await browser.waitUntil(async () => (await caption()) === "Map the essay before you write it", {
      timeout: 5_000,
      timeoutMsg: "→ didn't move the carousel",
    });
    await clickButton("Start writing");
    await browser.waitUntil(
      async () => !(await browser.execute(() => !!document.querySelector(".onb"))),
      { timeout: 5_000, timeoutMsg: "onboarding stayed open" },
    );
    await browser.waitUntil(
      () => {
        try {
          return JSON.parse(readFileSync(join(APP_DATA, "preferences.json"), "utf8"))[
            "onboarding.done"
          ];
        } catch {
          return false;
        }
      },
      { timeout: 5_000, timeoutMsg: "onboarding.done wasn't saved" },
    );
  });

  it("ONB-05 YouTube: a click on the empty line writes it, then the guide asks for ⌘S", async () => {
    // Shown again from the palette, it starts on the AI screen.
    await pressCmd("p");
    const input = await $("[cmdk-input]");
    await input.waitForExist({ timeout: 8_000 });
    await input.setValue("Show Onboarding");
    const item = await $('//*[@cmdk-item][contains(., "Show Onboarding")]');
    await item.waitForExist({ timeout: 8_000 });
    await item.click();
    await waitForTitle("Which AI should Pensée use?");
    await clickButton("Skip for now");
    await clickButton("YouTube");
    await browser.waitUntil(async () => (await guideText())?.includes("Click the line"), {
      timeout: 15_000,
      timeoutMsg: `no step 1: ${await guideText()}`,
    });
    const line = await $(".cm-content .cm-line:last-child");
    await line.click();
    await browser.waitUntil(
      async () =>
        String(
          await browser.execute(() => document.querySelector(".cm-content")?.textContent),
        ).includes("Rewarding yourself after studying can make studying feel worse."),
      { timeout: 10_000, timeoutMsg: "Pensée didn't write the line" },
    );
    await browser.waitUntil(async () => (await guideText())?.includes("Now ⌘S pins it"), {
      timeout: 5_000,
      timeoutMsg: `the guide didn't move on: ${await guideText()}`,
    });
  });
});
