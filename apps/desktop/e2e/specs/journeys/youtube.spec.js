// YouTube notes (docs/qa/user-journeys.md § YouTube notes — YT): the
// transcript box. A note's `<details>` transcript shows as a teleprompter
// that follows the video, seeks on a click, copies and hands questions to the
// Agent. The player's position is the app's own estimate after a seek, so
// these journeys don't wait on YouTube.
import { equal, ok } from "node:assert/strict";
import { execSync } from "node:child_process";
import { pressCmd, waitForTitle, workspaceRoot } from "./_helpers.js";

/** Seeded by qa/seed-vault.mjs: four timed paragraphs, two sentences each. */
const NOTE = "Speech talk";

/** The box's lines as the user sees them, and which one is being said. */
async function boxState() {
  return browser.execute(() => {
    const lines = [...document.querySelectorAll(".transcript-box-line")];
    return {
      // The revealed line also holds a hidden copy for screen readers: read
      // the words on screen.
      lines: lines.map((line) => {
        const p = line.querySelector("p");
        return (p?.querySelector('[aria-hidden="true"]') ?? p)?.textContent ?? "";
      }),
      now: lines.findIndex((line) => line.dataset.state === "now"),
      editorText:
        document.querySelector(".transcript-box")?.closest(".cm-content")?.textContent ?? "",
    };
  });
}

describe("YouTube notes: transcript box", function () {
  before(async function () {
    await workspaceRoot();
    await pressCmd("o");
    const input = await $("[cmdk-input]");
    await input.waitForExist({ timeout: 5_000 });
    await input.setValue(NOTE);
    const item = await $(`//*[@cmdk-item][contains(., "${NOTE}")]`);
    await item.waitForExist({ timeout: 10_000 });
    await item.click();
    await waitForTitle(NOTE);
    await $(".transcript-box").waitForExist({ timeout: 15_000 });
  });

  it("YT-04 ★ a note with a transcript shows the box, never the HTML", async function () {
    const state = await boxState();
    ok(state.lines.length >= 8, `expected a line per sentence, got ${state.lines.length}`);
    equal(state.lines[0], "Welcome to the show about speech.");
    equal(state.now, 0, "before the video plays, the first line is the one being said");
    ok(!state.editorText.includes("<summary>"), "the raw <summary> shows in the note");
    ok(!state.editorText.includes("<p><small>"), "the raw <p><small> shows in the note");
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-04-box.png`);
  });

  it("YT-05 clicking a line plays from it and keeps the box", async function () {
    const target = await $$(".transcript-box-line")[2];
    await target.click();
    await browser.waitUntil(async () => (await boxState()).now === 2, {
      timeout: 3_000,
      timeoutMsg: "the clicked line didn't become the one being said",
    });
    const time = await browser.execute(
      () =>
        document.querySelector(".transcript-box-line[data-state='now'] .transcript-box-time")
          ?.textContent,
    );
    equal(time, "1:00");
    const state = await boxState();
    ok(!state.editorText.includes("<summary>"), "a click inside opened the source");
  });

  it("YT-06 scrolling the box stops it following until Back to now", async function () {
    await browser.execute(() => {
      const list = document.querySelector(".transcript-box-lines");
      list.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true }));
      list.scrollTop += 120;
    });
    const back = await $("//button[normalize-space(.)='Back to now']");
    await back.waitForExist({ timeout: 3_000 });
    await back.click();
    await back.waitForExist({ timeout: 3_000, reverse: true });
  });

  it("YT-07 Copy puts the whole transcript, with times, on the clipboard", async function () {
    const copy = await $(
      "//section[contains(@class,'transcript-box')]//button[contains(., 'Copy')]",
    );
    await copy.click();
    await $(
      "//section[contains(@class,'transcript-box')]//button[contains(., 'Copied')]",
    ).waitForExist({ timeout: 3_000 });
    // WebKit won't let a script read the clipboard back: ask macOS.
    const text = execSync("pbpaste", { encoding: "utf8" });
    ok(text.startsWith("0:00 Welcome to the show about speech."), text);
    ok(text.includes("\n\n1:00 Speech is a motor act"), text);
  });

  it("YT-08 Ask opens the Agent with its input focused", async function () {
    const ask = await $("//section[contains(@class,'transcript-box')]//button[contains(., 'Ask')]");
    await ask.click();
    await $('[aria-label="Agent"]').waitForExist({ timeout: 5_000 });
    await browser.waitUntil(
      () => browser.execute(() => document.activeElement?.getAttribute("aria-label") === "Message"),
      { timeout: 3_000, timeoutMsg: "the Agent's input didn't take focus" },
    );
  });
});
