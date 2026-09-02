import { ok, strictEqual } from "node:assert/strict";

function todayStamp() {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function invoke(command, args) {
  const result = await browser.executeAsync(
    (cmd, cmdArgs, done) => {
      window.__TAURI_INTERNALS__
        .invoke(cmd, cmdArgs)
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    },
    command,
    args ?? {},
  );
  return result;
}

async function pressCmd(key, shift = false) {
  await browser.execute(
    (pressedKey, shiftKey) => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: pressedKey,
          metaKey: true,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    key,
    shift,
  );
}

describe("Daily note", function () {
  let root;

  before(async function () {
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 15_000 });
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
    const recents = await invoke("get_recent_workspaces");
    ok(recents.ok, `recent workspaces failed: ${recents.error}`);
    root = typeof recents.value[0] === "string" ? recents.value[0] : recents.value[0].path;
    ok(root, "expected a restored workspace root");

    // Reruns must start from the unconfigured default with no note for today.
    await invoke("reset_setting", { key: "workspace.daily-note-folder", scope: "workspace" });
    await invoke("delete_entry", { path: `${root}/${todayStamp()}.md` });
    await invoke("delete_entry", { path: `${root}/Journal` });
    await browser.refresh();
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 15_000 });
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
  });

  it("offers Today's note on the new tab page", async function () {
    await pressCmd("t");
    const button = await $('//button[contains(., "Today\'s note")]');
    await button.waitForExist({ timeout: 5_000 });
    ok((await button.getText()).includes("⌘⇧N"), "expected the ⌘⇧N hint");
  });

  it("creates and opens today's note at the workspace root", async function () {
    const button = await $('//button[contains(., "Today\'s note")]');
    await button.click();

    const expected = `${root}/${todayStamp()}.md`;
    await browser.waitUntil(
      async () => (await invoke("file_exists", { path: expected })).value === true,
      {
        timeout: 5_000,
        timeoutMsg: `expected ${expected} to be created`,
      },
    );
    const created = await invoke("read_file", { path: expected });
    ok(created.ok, `read failed: ${created.error}`);
    strictEqual(created.value.content, "# ");
  });

  it("reopens the same note without clobbering it", async function () {
    const expected = `${root}/${todayStamp()}.md`;
    const edited = "# Today\n\nalready written";
    const write = await invoke("write_file", { path: expected, content: edited });
    ok(write.ok, `write failed: ${write.error}`);

    await pressCmd("n", true);
    await browser.pause(1_000);

    const after = await invoke("read_file", { path: expected });
    strictEqual(after.value.content, edited, "Cmd+Shift+N must not overwrite an existing note");
  });

  it("honors the Daily Note Folder setting", async function () {
    const set = await invoke("set_setting", {
      key: "workspace.daily-note-folder",
      value: "Journal/Daily",
      scope: "workspace",
    });
    ok(set.ok, `set_setting failed: ${set.error}`);

    // Rehydrate so the frontend store reads the freshly persisted value.
    await browser.refresh();
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 15_000 });
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });

    await pressCmd("n", true);

    const expected = `${root}/Journal/Daily/${todayStamp()}.md`;
    await browser.waitUntil(
      async () => (await invoke("file_exists", { path: expected })).value === true,
      {
        timeout: 5_000,
        timeoutMsg: `expected ${expected} to be created`,
      },
    );
  });

  it("exposes the palette command", async function () {
    await pressCmd("p");
    const command = await $('[cmdk-item][data-value="daily-note"]');
    await command.waitForExist({ timeout: 5_000 });
    ok((await command.getText()).includes("Open Today's Note"));
    await browser.execute(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
  });
});
