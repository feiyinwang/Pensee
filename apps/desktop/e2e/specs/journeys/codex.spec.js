// Codex: Pensée on a ChatGPT plan (docs/qa/user-journeys.md § Codex — CDX,
// SPECs/codex-spec.md). CDX-01…03 need Codex installed and signed in on this
// Mac (`codex login status`), and spend a few real requests on its plan; they
// skip otherwise. CDX-05 needs Codex signed OUT: run it on a sandbox Codex so
// this Mac's own sign-in is never touched:
//   CODEX_HOME=$(mktemp -d) e2e/qa/run.sh --only CDX-05
import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { invoke, pressCmd, waitForTitle, workspaceRoot } from "./_helpers.js";

const REPLY_TIMEOUT = 90_000;

async function palette(query, label = query) {
  await pressCmd("p");
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue(query);
  const item = await $(`//*[@cmdk-item][contains(., "${label}")]`);
  await item.waitForExist({ timeout: 5_000 });
  await item.click();
}

/** Settings → Agent → AI, picked like a writer picks it. */
async function chooseCodex() {
  await palette("Settings");
  await $("//h1[normalize-space(.)='Preferences']").waitForExist({ timeout: 5_000 });
  const select = await $('//select[option[@value="codex"]]');
  await select.waitForExist({ timeout: 5_000 });
  // WebDriver's selectByAttribute sends no change event here: pick the option
  // as the browser does, then fire the change React listens for.
  await browser.execute(() => {
    const el = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "codex"),
    );
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "codex");
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await browser.waitUntil(
    async () => (await invoke("get_setting", { key: "agent.provider" })).value === "codex",
    { timeout: 5_000, timeoutMsg: "picking Codex wasn't saved" },
  );
}

async function openNote(name) {
  await pressCmd("o");
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue(name);
  const item = await $(`//*[@cmdk-item][contains(., "${name}")]`);
  await item.waitForExist({ timeout: 5_000 });
  await item.click();
  await waitForTitle(name);
}

const chat = () =>
  browser.execute(() => ({
    rows: [...document.querySelectorAll('[aria-label="Agent"] [data-agent-row]')].map((row) => ({
      role: row.getAttribute("data-agent-row"),
      text: row.textContent ?? "",
    })),
    model: document.querySelector('[aria-label="Agent"] button[title^="Switch model"]')
      ?.textContent,
    running: !!document.querySelector('[aria-label="Agent"] button[aria-label="Stop"]'),
  }));

async function askAgent(text) {
  const input = await $('[aria-label="Agent"] textarea[aria-label="Message"]');
  if (!(await input.isExisting())) await pressCmd("j");
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

/** Waits for the reply to the message just sent to finish, and returns the
 *  rows after that message. */
async function waitForReply(sent) {
  let rows = [];
  await browser
    .waitUntil(
      async () => {
        const now = await chat();
        const at = now.rows.findLastIndex((row) => row.role === "user" && row.text === sent);
        rows = at < 0 ? [] : now.rows.slice(at + 1);
        return !now.running && rows.some((row) => row.role === "assistant" || row.role === "error");
      },
      { timeout: REPLY_TIMEOUT },
    )
    .catch(() => {
      throw new Error(`no reply to "${sent}": ${JSON.stringify(rows)}`);
    });
  return rows;
}

describe("Journeys: Codex", function () {
  this.timeout(180_000);
  let signedIn = false;

  before(async function () {
    await workspaceRoot();
    const status = await invoke("claude_auth_status", { provider: "codex" });
    signedIn = status.ok && status.value === true;
  });

  after(async function () {
    await invoke("set_setting", { key: "agent.provider", value: "claude", scope: "global" });
  });

  it("CDX-01 ★ Settings → AI → Codex (ChatGPT): the account row is ChatGPT's", async function () {
    if (!signedIn) this.skip();
    await chooseCodex();
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document
              .querySelector("[data-settings-panel] [data-claude-account]")
              ?.getAttribute("data-claude-account") === "signed-in",
        ),
      { timeout: 15_000, timeoutMsg: "the row never read Codex's sign-in" },
    );
    const row = await browser.execute(
      () => document.querySelector("[data-settings-panel] [data-claude-account]")?.textContent,
    );
    ok(row.startsWith("ChatGPT"), `the row names ChatGPT: ${row}`);
    ok(row.includes("use Codex on this Mac"), `the row names Codex: ${row}`);
  });

  it("CDX-02 with Codex, the Agent answers about the page, on Luna", async function () {
    if (!signedIn) this.skip();
    await chooseCodex();
    await openNote("Welcome");
    await pressCmd("j");
    await browser.waitUntil(async () => (await chat()).model === "Luna", {
      timeout: 5_000,
      timeoutMsg: "the model chip doesn't name Codex's fastest model",
    });
    const sent = "What is the first line of this page? Quote it, nothing else.";
    await askAgent(sent);
    const rows = await waitForReply(sent);
    const reply = rows
      .filter((row) => row.role === "assistant")
      .map((row) => row.text)
      .join(" ");
    ok(!rows.some((row) => row.role === "error"), `no error: ${JSON.stringify(rows)}`);
    ok(reply.includes("A note to open first"), `the reply quotes the page: ${reply}`);
  });

  it("CDX-03 with Codex, the Agent edits the page on disk", async function () {
    if (!signedIn) this.skip();
    await chooseCodex();
    await openNote("Welcome");
    const sent = "Add the line `Codex was here.` at the very end of this page.";
    await askAgent(sent);
    const rows = await waitForReply(sent);
    ok(!rows.some((row) => row.role === "error"), `no error: ${JSON.stringify(rows)}`);
    ok(
      rows.some((row) => row.role === "tool" && row.text.startsWith("Edited Welcome.md")),
      `an Edited row: ${JSON.stringify(rows)}`,
    );
    const root = await workspaceRoot();
    const text = readFileSync(join(root, "Welcome.md"), "utf8");
    ok(text.trimEnd().endsWith("Codex was here."), `the file ends with the line: ${text}`);
  });

  it("CDX-05 Codex signed out: the Agent says ChatGPT is signed out at once, and the popup offers Sign in", async function () {
    if (signedIn) this.skip();
    const installed = await invoke("claude_installed", { provider: "codex" });
    if (!installed.value) this.skip();
    await chooseCodex();
    await openNote("Welcome");
    const started = Date.now();
    const sent = "say hi";
    await askAgent(sent);
    const rows = await waitForReply(sent);
    const error = rows.find((row) => row.role === "error")?.text;
    equal(error, "ChatGPT is signed out. Sign in, then try again.");
    // Not after Codex's five retries (~17 s).
    ok(Date.now() - started < 12_000, `took ${Date.now() - started}ms`);
    const card = await browser.execute(() => {
      const el = document.querySelector(".claude-sign-in");
      return el
        ? {
            title: el.querySelector(".claude-sign-in-title")?.textContent,
            code: !el.querySelector(".claude-sign-in-code")?.hidden,
          }
        : null;
    });
    ok(card, "the sign-in popup opened");
    equal(card.title, "ChatGPT is signed out");
    equal(card.code, false, "no code field for Codex");
  });
});
