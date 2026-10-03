import { ok } from "node:assert/strict";

// Mermaid → board (SPECs/board-lark-parity-spec.md): a flowchart fence in a
// note shows "Convert to board"; converting writes a .board.svg with the
// diagram as editable shapes and swaps the fence for an image line.
//
// Seed `flowchart-e2e.md` before launch (see board-file.spec.js); self-skips
// without a restorable workspace.
describe("Board from Mermaid flowchart", function () {
  const FILE_STEM = "flowchart-e2e";
  let workspaceRestored = false;
  let root = null;

  async function invoke(cmd, args) {
    return browser.executeAsync(
      (c, a, done) => {
        window.__TAURI_INTERNALS__
          .invoke(c, a)
          .then((v) => done({ ok: true, value: v }))
          .catch((e) => done({ ok: false, error: e && e.message ? e.message : String(e) }));
      },
      cmd,
      args,
    );
  }

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    if (!workspaceRestored) return;
    const recents = await invoke("get_recent_workspaces", {});
    root = recents.ok ? recents.value[0] : null;
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (!root) return;
    await invoke("delete_entry", { path: `${root}/${FILE_STEM}.md` });
    await invoke("delete_entry", { path: `${root}/${FILE_STEM}-assets` });
  });

  it("converts the fence and opens an editable board", async function () {
    await (await $("span*=Flowchart check")).click();
    const button = await $('button[aria-label="Convert to board"]');
    await button.waitForExist({ timeout: 10_000 });
    await browser.execute(() =>
      document.querySelector('button[aria-label="Convert to board"]').click(),
    );
    await $(".wr-board-fullscreen").waitForExist({ timeout: 10_000 });

    const note = await browser.waitUntil(
      async () => {
        const r = await invoke("read_file", { path: `${root}/${FILE_STEM}.md` });
        const t = r.ok ? r.value.content : "";
        return t.includes(".board.svg") ? t : false;
      },
      { timeout: 15_000, timeoutMsg: "fence was not replaced by the board image" },
    );
    ok(!note.includes("```mermaid"), "mermaid fence still in the note");

    const counts = await browser.execute(() => ({
      shapes: document.querySelectorAll(
        '.wr-board-fullscreen [data-type="rect"], .wr-board-fullscreen [data-type="diamond"], .wr-board-fullscreen [data-type="roundRect"]',
      ).length,
      arrows: document.querySelectorAll('.wr-board-fullscreen [data-type="arrow"]').length,
    }));
    ok(counts.shapes === 4, `expected 4 shapes, got ${counts.shapes}`);
    ok(counts.arrows === 4, `expected 4 arrows, got ${counts.arrows}`);

    const rel = /\]\(([^)]+\.board\.svg)\)/.exec(note)[1];
    const file = await invoke("read_file", { path: `${root}/${rel}` });
    ok(file.ok && file.value.content.includes("Ready?"), "board file is missing the diagram");
  });
});
