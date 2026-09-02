import { ok, strictEqual } from "node:assert/strict";
import { writeFileSync } from "node:fs";

// Block-handle heading conversion: two lines with no blank line between them
// are ONE markdown paragraph — which is what a single Enter produces — and
// turning that block into a heading used to stamp a `#` onto every line, so
// the next line's content got one too. Seeds such a paragraph, opens the
// gutter handle's panel over it, clicks the H1 tile, and reads the file back.
//
// Requires a restorable workspace: seed
// `~/Library/Application Support/com.writer-computer.e2e/recent_workspaces.json`
// with a real directory before launching. Without one the app lands on the
// welcome screen and this suite self-skips.
describe("Block handle heading conversion", function () {
  const FILE_STEM = "block-handle-heading-e2e";
  const FIRST = "now i have it done";
  const SECOND = "next line content";
  const DOC = `${FIRST}\n${SECOND}\n`;

  let workspaceRestored = false;
  let filePath = null;

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

  /** The gutter plugin listens for real `mousemove` on `view.dom`, so the grip
   *  is summoned the same way a hand summons it — by pointing at the line. */
  async function hover(x, y) {
    await browser.execute(
      (px, py) => {
        const dom = document.querySelector(".cm-editor");
        if (!dom) return;
        dom.dispatchEvent(
          new MouseEvent("mousemove", {
            clientX: px,
            clientY: py,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      x,
      y,
    );
  }

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    if (!workspaceRestored) return;

    const recents = await invoke("get_recent_workspaces", {});
    const root = recents.ok && Array.isArray(recents.value) ? recents.value[0] : null;
    ok(root, "no workspace root to seed the document into");

    // Written from the harness, not through the app: a file created after
    // startup reaches the sidebar via the workspace watcher, and waiting on
    // that would be timing the watcher rather than the menu.
    filePath = `${root}/${FILE_STEM}.md`;
    writeFileSync(filePath, DOC);
    await browser.refresh();
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 15_000 });
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (filePath) await invoke("delete_entry", { path: filePath });
  });

  it("opens the seeded paragraph from the sidebar", async function () {
    const item = await $(`span*=${FILE_STEM}`);
    await item.waitForExist({ timeout: 15_000 });
    await item.click();

    await browser.waitUntil(async () => (await $$(".cm-content")).length > 0, {
      timeout: 10_000,
      timeoutMsg: "editor never mounted",
    });
    await browser.waitUntil(async () => (await $(".cm-content").getText()).includes(FIRST), {
      timeout: 10_000,
      timeoutMsg: "seeded paragraph never rendered",
    });
  });

  /** Which rendered line the grip is currently centred on. */
  async function gripLineIndex() {
    return browser.execute(() => {
      const el = document.querySelector(".wr-gutter-grab");
      const r = el.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      return [...document.querySelectorAll(".cm-line")].findIndex((l) => {
        const b = l.getBoundingClientRect();
        return mid >= b.top && mid <= b.bottom;
      });
    });
  }

  it("parks the grip on the line under the pointer, not the paragraph's first", async function () {
    // The bug: a paragraph is every consecutive non-blank line, so pointing at
    // the second line resolved to the whole node and the grip jumped up to the
    // first — heading the line above the one being pointed at.
    const second = await browser.execute(() => {
      const r = document.querySelectorAll(".cm-line")[1].getBoundingClientRect();
      return { x: r.left + 30, y: r.top + r.height / 2 };
    });
    await hover(second.x, second.y);
    await $(".wr-gutter-grab.wr-gutter-on").waitForExist({ timeout: 5_000 });
    strictEqual(await gripLineIndex(), 1, "grip did not follow the pointer to line 2");
  });

  it("opens the block handle panel over the paragraph", async function () {
    const box = await browser.execute(() => {
      const line = document.querySelector(".cm-line");
      if (!line) return null;
      const r = line.getBoundingClientRect();
      return { x: r.left + 20, y: r.top + r.height / 2 };
    });
    ok(box, "no first line to point at");

    await hover(box.x, box.y);
    await $(".wr-gutter-grab.wr-gutter-on").waitForExist({
      timeout: 5_000,
      timeoutMsg: "grip never parked beside the paragraph",
    });

    // The panel opens on `mouseenter` over the grip, which does not bubble —
    // it has to be dispatched on the handle itself. Then rest there past
    // MENU_OPEN_DELAY (220ms).
    await browser.execute(() => {
      const el = document.querySelector(".wr-gutter-grab");
      const r = el.getBoundingClientRect();
      el.dispatchEvent(
        new MouseEvent("mouseenter", {
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
        }),
      );
    });

    await browser.waitUntil(
      async () => (await $$('.wr-bmenu-tile[aria-label="Heading 1"]')).length > 0,
      { timeout: 5_000, timeoutMsg: "block handle panel never opened" },
    );

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/block-handle-menu-open.png`);
    }
  });

  it("heads only the line the grip is beside", async function () {
    await $('.wr-bmenu-tile[aria-label="Heading 1"]').click();

    await browser.waitUntil(async () => (await $(".cm-content").getText()).includes(SECOND), {
      timeout: 5_000,
      timeoutMsg: "document never settled after the conversion",
    });

    const text = await browser.execute(() => {
      const lines = Array.from(document.querySelectorAll(".cm-line"));
      return lines.map((l) => l.textContent).join("\n");
    });

    // The heading takes the first line. The next line's content keeps its own,
    // with no `#` in front of it — the whole point of the fix.
    ok(text.includes(FIRST), `first line missing: ${JSON.stringify(text)}`);
    ok(text.includes(SECOND), `second line missing: ${JSON.stringify(text)}`);
    ok(
      !text.includes(`# ${SECOND}`),
      `the heading leaked onto the next line: ${JSON.stringify(text)}`,
    );

    // The document on disk is the real assertion — the rendered text hides the
    // hanging hash, so only the source says which lines actually got one.
    const read = await invoke("read_file", { path: filePath });
    ok(read.ok, `could not read back ${filePath}: ${read.error}`);
    const content = typeof read.value === "string" ? read.value : read.value?.content;
    // No blank line inserted: the grip addresses the line, so heading line 1
    // leaves nothing to split off — line 2 stays exactly where it was.
    strictEqual(
      content.trimEnd(),
      `# ${FIRST}\n${SECOND}`,
      `unexpected markdown on disk: ${JSON.stringify(content)}`,
    );

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/block-handle-heading.png`);
    }
  });

  it("heads the second line when the second line is the one pointed at", async function () {
    // The whole complaint, end to end: point at line 2, get the heading on
    // line 2 — never on the line above it.
    const reset = `${FIRST}\n${SECOND}\n`;
    writeFileSync(filePath, reset);
    await browser.refresh();
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 15_000 });
    const item = await $(`span*=${FILE_STEM}`);
    await item.waitForExist({ timeout: 15_000 });
    await item.click();
    await browser.waitUntil(async () => (await $(".cm-content").getText()).includes(SECOND), {
      timeout: 10_000,
      timeoutMsg: "document never reloaded",
    });

    const second = await browser.execute(() => {
      const r = document.querySelectorAll(".cm-line")[1].getBoundingClientRect();
      return { x: r.left + 30, y: r.top + r.height / 2 };
    });
    await hover(second.x, second.y);
    await $(".wr-gutter-grab.wr-gutter-on").waitForExist({ timeout: 5_000 });
    strictEqual(await gripLineIndex(), 1, "grip did not follow the pointer to line 2");

    await browser.execute(() => {
      const el = document.querySelector(".wr-gutter-grab");
      const r = el.getBoundingClientRect();
      el.dispatchEvent(
        new MouseEvent("mouseenter", {
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
        }),
      );
    });
    await browser.waitUntil(
      async () => (await $$('.wr-bmenu-tile[aria-label="Heading 2"]')).length > 0,
      { timeout: 5_000, timeoutMsg: "block handle panel never opened on line 2" },
    );
    await $('.wr-bmenu-tile[aria-label="Heading 2"]').click();
    await browser.pause(400);

    const read = await invoke("read_file", { path: filePath });
    ok(read.ok, `could not read back ${filePath}: ${read.error}`);
    const content = typeof read.value === "string" ? read.value : read.value?.content;
    strictEqual(
      content.trimEnd(),
      `${FIRST}\n## ${SECOND}`,
      `the heading landed on the wrong line: ${JSON.stringify(content)}`,
    );

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/block-handle-heading-line2.png`);
    }
  });
});
