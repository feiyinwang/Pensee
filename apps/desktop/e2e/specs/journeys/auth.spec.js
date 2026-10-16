// Claude sign-in popup and the Claude row in Settings (AUTH in
// docs/qa/user-journeys.md, SPECs/claude-sign-in-spec.md). Most need Claude
// Code signed OUT, the state the popup is for; signed in, they skip. Run them
// on a sandbox Claude so this Mac's own sign-in is never touched:
//   CLAUDE_CONFIG_DIR=$(mktemp -d) e2e/qa/run.sh auth
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
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
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
    const behind = await browser.execute(() => {
      const el = document.elementFromPoint(8, window.innerHeight - 8);
      return el ? !el.closest(".claude-sign-in-layer") : false;
    });
    ok(behind, "no backdrop: the app behind the popup takes clicks");
    const chat = await browser.execute(
      () => document.querySelector('[aria-label="Agent"]')?.textContent ?? "",
    );
    ok(chat.includes("Claude is signed out. Sign in, then try again."), `chat says: ${chat}`);
    ok(!chat.includes("authentication_error"), "no raw API error in the chat");

    await browser.execute(() =>
      document
        .querySelector(".claude-sign-in")
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        ),
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
      async () => (await popup())?.buttons.some((b) => b === "Open the sign-in page again"),
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

/** The Claude row in Settings → Agent. */
const accountRow = () =>
  browser.execute(() => {
    const row = document.querySelector("[data-settings-panel] [data-claude-account]");
    if (!row) return null;
    return {
      state: row.getAttribute("data-claude-account"),
      text: row.textContent,
      section: row.closest("section")?.querySelector("h2")?.textContent ?? "",
      buttons: [...row.querySelectorAll("button")].map((b) => ({
        label: b.textContent,
        disabled: b.disabled,
      })),
    };
  });

async function openSettings() {
  await pressCmd("f");
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue("Settings");
  const item = await $('//*[@cmdk-item][contains(., "Settings")]');
  await item.waitForExist({ timeout: 5_000 });
  await item.click();
  await $("//h1[normalize-space(.)='Preferences']").waitForExist({ timeout: 5_000 });
}

async function clickRowButton(label) {
  await browser.execute((label) => {
    [...document.querySelectorAll("[data-settings-panel] [data-claude-account] button")]
      .find((b) => b.textContent === label)
      .click();
  }, label);
}

describe("Journeys: Claude account in Settings", function () {
  this.timeout(120_000);
  let signedIn;

  before(async function () {
    await workspaceRoot();
    const status = await invoke("claude_auth_status");
    // A Claude Code too old to say has nothing for the row to show.
    if (!status.ok) this.skip();
    signedIn = status.value;
    await openSettings();
  });

  it("AUTH-05 Settings → Agent shows whether Claude is signed in", async function () {
    const want = signedIn ? "signed-in" : "signed-out";
    await browser.waitUntil(async () => (await accountRow())?.state === want, {
      timeout: 20_000,
      timeoutMsg: `the Claude row never showed ${want}: ${JSON.stringify(await accountRow())}`,
    });
    const row = await accountRow();
    ok(row.section === "Agent", `the row sits in ${row.section}`);
    ok(row.text.startsWith("Claude"), `row text: ${row.text}`);
    const labels = row.buttons.map((b) => b.label).join(" | ");
    ok(labels === (signedIn ? "Sign out" : "Sign in"), `buttons: ${labels}`);
  });

  it("AUTH-06 signed out, Sign in opens the popup waiting for the browser; Cancel ends it", async function () {
    if (signedIn) this.skip();
    await clickRowButton("Sign in");
    await browser.waitUntil(
      async () => (await popup())?.buttons.some((b) => b.startsWith("Cancel")),
      { timeout: 10_000, timeoutMsg: "Sign in didn't open the popup waiting" },
    );
    const waiting = await popup();
    ok(waiting.body.startsWith("Finish signing in in your browser"), `popup: ${waiting.body}`);
    const row = await accountRow();
    ok(
      row.buttons.length === 1 && row.buttons[0].label === "Waiting…" && row.buttons[0].disabled,
      `row while waiting: ${JSON.stringify(row.buttons)}`,
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
    const after = await accountRow();
    ok(
      after.buttons.map((b) => b.label).join() === "Sign in" && !after.buttons[0].disabled,
      `row after Cancel: ${JSON.stringify(after.buttons)}`,
    );
    const status = await invoke("claude_auth_status");
    ok(status.ok && status.value === false, `still signed out: ${JSON.stringify(status)}`);
  });

  it("AUTH-07 signed in, Sign out signs Claude Code out", async function () {
    // Only against a sandbox Claude (CLAUDE_CONFIG_DIR): a run must never sign
    // out the Claude Code this Mac works with.
    if (!signedIn || !process.env.CLAUDE_CONFIG_DIR || process.env.ANTHROPIC_API_KEY) this.skip();
    await clickRowButton("Sign out");
    await browser.waitUntil(async () => (await accountRow())?.state === "signed-out", {
      timeout: 30_000,
      timeoutMsg: `Sign out never finished: ${JSON.stringify(await accountRow())}`,
    });
    const row = await accountRow();
    ok(row.buttons.map((b) => b.label).join() === "Sign in", `row: ${JSON.stringify(row)}`);
    const status = await invoke("claude_auth_status");
    ok(status.ok && status.value === false, `signed out: ${JSON.stringify(status)}`);
  });

  it("AUTH-09 signed in through an API key, Sign out says Claude Code is still signed in", async function () {
    // A sandbox Claude with a dummy ANTHROPIC_API_KEY: `claude auth logout`
    // can't end a sign-in that comes from the shell.
    if (!signedIn || !process.env.CLAUDE_CONFIG_DIR || !process.env.ANTHROPIC_API_KEY) {
      this.skip();
    }
    await clickRowButton("Sign out");
    await browser.waitUntil(async () => (await accountRow())?.text.includes("still signed in"), {
      timeout: 30_000,
      timeoutMsg: `no reason shown: ${JSON.stringify(await accountRow())}`,
    });
    const row = await accountRow();
    ok(row.state === "signed-in", `row: ${JSON.stringify(row)}`);
    ok(row.text.includes("claude auth logout"), `row tells what to run: ${row.text}`);
    ok(
      row.buttons.map((b) => b.label).join() === "Sign out" && !row.buttons[0].disabled,
      `row: ${JSON.stringify(row.buttons)}`,
    );
  });
});
