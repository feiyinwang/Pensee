// Claude sign-in popup (AUTH in docs/qa/user-journeys.md,
// SPECs/claude-sign-in-spec.md). These journeys need Claude Code signed OUT
// on this Mac, the state the popup is for; signed in, they skip.
import { ok } from "node:assert/strict";
import { invoke, pressCmd, workspaceRoot } from "./_helpers.js";

const REPLY_TIMEOUT = 60_000;

const popup = () =>
  browser.execute(() => {
    const card = document.querySelector(".claude-sign-in");
    if (!card) return null;
    return {
      title: card.querySelector(".claude-sign-in-title")?.textContent ?? "",
      body: card.querySelector(".claude-sign-in-body")?.textContent ?? "",
      buttons: [...card.querySelectorAll(".claude-sign-in-actions button")].map(
        (b) => b.textContent,
      ),
      focused: card.contains(document.activeElement),
      rect: card.getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
    };
  });

async function askAgent(text) {
  await pressCmd("j");
  const input = await $('[aria-label="Agent"] textarea[aria-label="Message"]');
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue(text);
  await browser.execute(() => {
    document
      .querySelector('[aria-label="Agent"] textarea[aria-label="Message"]')
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}

describe("Journeys: Claude sign-in", function () {
  this.timeout(120_000);

  before(async function () {
    await workspaceRoot();
    const status = await invoke("claude_auth_status");
    // Signed in (or a Claude Code too old to say): nothing to sign in to.
    if (!status.ok || status.value) this.skip();
  });

  it("AUTH-01 a message to the Agent while signed out opens the sign-in popup; Esc closes it", async function () {
    await askAgent("say hi");
    await browser.waitUntil(async () => (await popup()) !== null, {
      timeout: REPLY_TIMEOUT,
      timeoutMsg: "the sign-in popup never opened",
    });
    const shown = await popup();
    ok(shown.title === "Claude is signed out", `title: ${JSON.stringify(shown)}`);
    ok(
      shown.buttons.join(" | ") === "Not nowEsc | Sign in↵",
      `buttons: ${JSON.stringify(shown.buttons)}`,
    );
    ok(shown.focused, "keys go to the popup");
    ok(
      shown.rect.left >= 16 && shown.rect.right <= shown.viewport.width - 16,
      `card inside the window: ${JSON.stringify(shown.rect)}`,
    );
    const chat = await browser.execute(
      () => document.querySelector('[aria-label="Agent"]')?.textContent ?? "",
    );
    ok(chat.includes("Claude is signed out. Sign in, then try again."), `chat says: ${chat}`);
    ok(!chat.includes("authentication_error"), "no raw API error in the chat");

    await browser.execute(() =>
      document
        .querySelector(".claude-sign-in")
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
    );
    await browser.waitUntil(async () => (await popup()) === null, {
      timeout: 2_000,
      timeoutMsg: "Esc didn't close the popup",
    });
  });

  it("AUTH-02 Sign in waits for the browser; Cancel stops it and closes the popup", async function () {
    await askAgent("say hi again");
    await browser.waitUntil(async () => (await popup()) !== null, {
      timeout: REPLY_TIMEOUT,
      timeoutMsg: "the sign-in popup never opened",
    });
    const before = await popup();
    await browser.execute(() =>
      [...document.querySelectorAll(".claude-sign-in-actions button")]
        .find((b) => b.textContent.startsWith("Sign in"))
        .click(),
    );
    await browser.waitUntil(
      async () => (await popup())?.buttons.some((b) => b.startsWith("Cancel")),
      { timeout: 10_000, timeoutMsg: "Sign in didn't start waiting" },
    );
    const waiting = await popup();
    ok(
      waiting.body.startsWith("Finish signing in in your browser"),
      `waiting says: ${waiting.body}`,
    );
    ok(
      Math.abs(waiting.rect.width - before.rect.width) < 1,
      `card width moved: ${before.rect.width} → ${waiting.rect.width}`,
    );
    ok(
      Math.abs(waiting.rect.height - before.rect.height) < 1,
      `card height moved: ${before.rect.height} → ${waiting.rect.height}`,
    );
    // Claude Code prints the sign-in page for when the browser didn't open.
    await browser.waitUntil(
      async () =>
        (await popup())?.buttons.some((b) => b === "Open the sign-in page again"),
      { timeout: 15_000, timeoutMsg: "no link to the sign-in page" },
    );
    await browser.execute(() =>
      [...document.querySelectorAll(".claude-sign-in-actions button")]
        .find((b) => b.textContent.startsWith("Cancel"))
        .click(),
    );
    await browser.waitUntil(async () => (await popup()) === null, {
      timeout: 2_000,
      timeoutMsg: "Cancel didn't close the popup",
    });
    // Nothing is left signing in: a second Sign in starts clean.
    const status = await invoke("claude_auth_status");
    ok(status.ok && status.value === false, `still signed out: ${JSON.stringify(status)}`);
  });
});
