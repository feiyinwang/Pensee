import { ok, strictEqual } from "node:assert/strict";
import { rmSync } from "node:fs";

// Every new note is born as the `# ` template (`create_file_impl`), so the very
// first Enter a note sees lands on an empty heading. It used to leave the
// hashes stranded on line 1 and put the words on line 2 — which renders as the
// `#` clamped onto the next line's content.
//
// Requires a restorable workspace; self-skips without one.
describe("Enter on the empty new-note heading", function () {
  let workspaceRestored = false;
  let filePath = null;

  async function invoke(cmd, args) {
    return browser.executeAsync(
      (c, a, done) => {
        window.__TAURI_INTERNALS__
          .invoke(c, a)
          .then((v) => done({ ok: true, value: v }))
          .catch((e) => done({ ok: false, error: String(e) }));
      },
      cmd,
      args,
    );
  }

  async function openFresh(stem) {
    const recents = await invoke("get_recent_workspaces", {});
    const root = recents.value[0];
    const path = `${root}/${stem}.md`;
    rmSync(path, { force: true });
    const made = await invoke("create_file", { path });
    ok(made.ok, `create_file failed: ${made.error}`);
    strictEqual(made.value.content, "# ", "the new-note template is no longer `# `");
    await browser.refresh();
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 15_000 });
    const item = await $(`span*=${stem}`);
    await item.waitForExist({ timeout: 15_000 });
    await item.click();
    await browser.waitUntil(async () => (await $$(".cm-content")).length > 0, { timeout: 10_000 });
    await browser.pause(400);
    return path;
  }

  async function pressEnter() {
    await browser.execute(() => {
      const target = document.querySelector(".cm-content");
      target.focus();
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await browser.pause(250);
  }

  async function type(text) {
    await browser.execute((t) => {
      const target = document.querySelector(".cm-content");
      target.focus();
      document.execCommand("insertText", false, t);
    }, text);
    await browser.pause(300);
  }

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (filePath) rmSync(filePath, { force: true });
  });

  it("leaves no stray hash when you press Enter and then type", async function () {
    filePath = await openFresh("empty-heading-e2e");
    await pressEnter();
    await type("now i have it done");

    const read = await invoke("read_file", { path: filePath });
    ok(read.ok, `could not read back: ${read.error}`);
    const content = typeof read.value === "string" ? read.value : read.value?.content;
    ok(!/^#+\s*$/m.test(content), `an empty heading was left behind: ${JSON.stringify(content)}`);
    strictEqual(
      content.trimEnd(),
      "now i have it done",
      `unexpected markdown on disk: ${JSON.stringify(content)}`,
    );

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/empty-heading-enter.png`);
    }
  });

  it("still writes a real heading when you type the title first", async function () {
    // The path that always worked has to keep working: the template is a title
    // placeholder, and typing straight into it must still produce an H1.
    const path = await openFresh("empty-heading-e2e-b");
    await type("now i have it done");
    const read = await invoke("read_file", { path });
    const content = typeof read.value === "string" ? read.value : read.value?.content;
    strictEqual(content.trimEnd(), "# now i have it done");
    rmSync(path, { force: true });
  });
});
