import { ok } from "node:assert/strict";

// Portable board files (SPECs/board-lark-parity-spec.md): a legacy ```board
// fence converts to a `.board.svg` on Open, the note keeps only an image line,
// the file carries both the rendered board and the scene, and the in-note
// preview is a plain <img> that loads the file.
//
// Self-skips without a restorable workspace (see latex-math.spec.js).
describe("Board file", function () {
  const FILE_STEM = "board-file-e2e";
  const HEADER = '{"v":1,"vp":{"x":0,"y":0,"zoom":1}}';
  const STICKY =
    '{"id":"s1","t":"sticky","x":0,"y":0,"w":200,"h":200,"c":"yellow","tx":"Hello board"}';
  const SHAPE =
    '{"id":"r1","t":"roundRect","x":260,"y":40,"w":180,"h":100,"st":{"s":"blue","f":"none"},"lb":{"tx":"Shape text"}}';
  const DOC = ["# Board check", "", "```board", HEADER, STICKY, SHAPE, "```", ""].join("\n");

  let workspaceRestored = false;
  let filePath = null;
  let root = null;
  let boardPath = null;

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
    root = recents.ok && Array.isArray(recents.value) ? recents.value[0] : null;
    ok(root, "no workspace root");
    filePath = `${root}/${FILE_STEM}.md`;
    const wrote = await invoke("write_file", { path: filePath, content: DOC });
    ok(wrote.ok, `failed to seed ${filePath}: ${wrote.error}`);
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (filePath) await invoke("delete_entry", { path: filePath });
    if (root) await invoke("delete_entry", { path: `${root}/${FILE_STEM}-assets` });
  });

  it("converts the fence to a .board.svg on Open", async function () {
    const row = await $("span*=Board check");
    await row.waitForExist({ timeout: 15_000 });
    await row.click();
    const card = await $(".wr-board-card");
    await card.waitForExist({ timeout: 10_000 });
    await card.click();
    await $(".wr-board-fullscreen").waitForExist({ timeout: 10_000 });

    // The folded image hides its URL from the DOM, so read the note as saved.
    const text = await browser.waitUntil(
      async () => {
        const note = await invoke("read_file", { path: filePath });
        const t = note.ok ? note.value.content : "";
        return t.includes(".board.svg") ? t : false;
      },
      { timeout: 15_000, timeoutMsg: "fence was not replaced by an image line" },
    );
    ok(!text.includes('"t":"sticky"'), "scene JSON is still in the note");
    boardPath = `${root}/${/\]\(([^)]+\.board\.svg)\)/.exec(text)[1]}`;
  });

  it("writes a file with the scene and a rendered layer", async function () {
    const file = await invoke("read_file", { path: boardPath });
    ok(file.ok, file.error);
    const svg = file.value.content;
    ok(svg.includes('<metadata id="writer-board">'), "no scene metadata");
    ok(svg.includes("Hello board"), "sticky text not rendered");
    ok(svg.includes("Shape text"), "shape label not rendered");
    ok(svg.includes("prefers-color-scheme:dark"), "no standalone colours");
    ok(!svg.includes("var(--text-"), "theme variables leaked into the file");
  });

  it("previews the file as a plain image after closing", async function () {
    await browser.execute(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await browser.execute(() => {
      const el = document.querySelector(".wr-board-fullscreen");
      if (el) el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    const img = await $(".wr-board-image img");
    await img.waitForExist({ timeout: 10_000 });
    await browser.waitUntil(
      async () => (await browser.execute((el) => el.complete && el.naturalWidth, img)) > 0,
      { timeout: 10_000, timeoutMsg: "board preview image never loaded" },
    );
    await browser.saveScreenshot("/tmp/board-file-preview.png");
  });
});
