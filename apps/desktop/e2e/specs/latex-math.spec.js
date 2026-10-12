import { ok } from "node:assert/strict";

// LaTeX math rendering verification: seeds a markdown file containing inline
// `$...$` and display `$$...$$` math into the restored workspace, opens it
// from the sidebar, and asserts the KaTeX fold widgets render and unfold to
// raw source when the selection enters the math range
// (see SPECs/latex-math-spec.md).
//
// Requires a restorable workspace: seed
// `~/Library/Application Support/com.writer-computer.e2e/recent_workspaces.json`
// with a real directory before launching. Without one the app lands on the
// welcome screen and this suite self-skips, so it stays safe inside the
// default `pnpm run test:e2e` sweep.
describe("LaTeX math rendering", function () {
  const FILE_STEM = "latex-math-e2e";
  const DOC = [
    "# Math check",
    "",
    "Euler: $e^{i\\pi} + 1 = 0$ inline.",
    "",
    "$$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$",
    "",
    "I paid $5 and $10 more.",
    "",
  ].join("\n");

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

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    if (!workspaceRestored) return;

    const recents = await invoke("get_recent_workspaces", {});
    const root = recents.ok && Array.isArray(recents.value) ? recents.value[0] : null;
    ok(root, "no workspace root to seed the math document into");

    filePath = `${root}/${FILE_STEM}.md`;
    const wrote = await invoke("write_file", { path: filePath, content: DOC });
    ok(wrote.ok, `failed to seed ${filePath}: ${wrote.error}`);
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (filePath) await invoke("delete_entry", { path: filePath });
  });

  it("opens the seeded document from the sidebar", async function () {
    // The workspace watcher picks the new file up; it appears in the
    // Files space's tree under its title ("Math check") or filename stem
    // depending on the sidebar-file-label setting.
    await $('[data-space-key="files"]').click();
    const row = await $(`span*=Math check`);
    await row.waitForExist({ timeout: 15_000 });
    await row.click();

    await browser.waitUntil(async () => (await $$(".cm-content")).length > 0, {
      timeout: 10_000,
      timeoutMsg: "editor never mounted",
    });
  });

  it("renders inline and display math as KaTeX widgets when the caret is elsewhere", async function () {
    const inline = await $(".cm-math-widget:not(.cm-math-display) .katex");
    await inline.waitForExist({ timeout: 10_000 });

    const display = await $(".cm-math-widget.cm-math-display .katex-display");
    await display.waitForExist({ timeout: 10_000 });

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/latex-math-rendered.png`);
    }
  });

  it("leaves currency prose as plain text", async function () {
    const widgets = await $$(".cm-math-widget");
    // Exactly the two seeded formulas — "$5 and $10" must not become math.
    ok(widgets.length === 2, `expected 2 math widgets, got ${widgets.length}`);
    const content = await $(".cm-content").getText();
    ok(content.includes("I paid $5 and $10 more."), "currency sentence should stay literal");
  });

  it("unfolds to raw source when the widget is clicked", async function () {
    const inline = await $(".cm-math-widget:not(.cm-math-display)");
    await inline.click();

    // The click-to-edit handler range-selects the math node; the fold drops
    // and the raw delimiters become part of the visible document text.
    await browser.waitUntil(
      async () => {
        const text = await $(".cm-content").getText();
        return text.includes("$e^{i\\pi} + 1 = 0$");
      },
      { timeout: 5_000, timeoutMsg: "inline math never unfolded to source" },
    );

    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/latex-math-unfolded.png`);
    }
  });
});
