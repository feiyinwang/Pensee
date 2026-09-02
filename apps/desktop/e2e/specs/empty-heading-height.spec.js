import { ok, strictEqual } from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";

// An empty heading — `#` alone, which is what you have the instant you type
// the hash on a blank line — used to collapse to its padding, because its only
// content is the absolutely-positioned hanging hash. The 46px glyph then hung
// off the bottom edge of a 16px line, straight over the line below: "the # is
// on the same line as my next line's content". The line has to hold its
// heading height with nothing in it.
//
// Requires a restorable workspace; self-skips without one.
describe("Empty heading line height", function () {
  const STEM = "empty-heading-height-e2e";
  let workspaceRestored = false;
  let filePath = null;

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    if (!workspaceRestored) return;
    const recents = await browser.executeAsync((done) =>
      window.__TAURI_INTERNALS__.invoke("get_recent_workspaces", {}).then(done),
    );
    filePath = `${recents[0]}/${STEM}.md`;
    // Empty h1, h2, h3 and a body-sized h4, each followed by the line that the
    // glyph used to land on; then filled headings as the reference heights.
    writeFileSync(
      filePath,
      [
        "#",
        "under one",
        "",
        "##",
        "under two",
        "",
        "###",
        "under three",
        "",
        "####",
        "under four",
        "",
        "# x",
        "## x",
        "### x",
        "#### x",
        "",
      ].join("\n"),
    );
    await browser.refresh();
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 15_000 });
    const item = await $(`span*=${STEM}`);
    await item.waitForExist({ timeout: 15_000 });
    await item.click();
    await browser.waitUntil(async () => (await $(".cm-content").getText()).includes("under four"), {
      timeout: 10_000,
    });
    await browser.pause(400);
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(function () {
    if (filePath) rmSync(filePath, { force: true });
  });

  async function measure() {
    return browser.execute(() =>
      [...document.querySelectorAll(".cm-line")].map((l) => {
        const r = l.getBoundingClientRect();
        const hash = l.querySelector(".cm-heading-hash");
        const h = hash ? hash.getBoundingClientRect() : null;
        return {
          text: l.textContent,
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          hash: h ? { top: h.top, bottom: h.bottom } : null,
        };
      }),
    );
  }

  it("holds an empty heading open at the same height as a filled one", async function () {
    const lines = await measure();
    const byText = (t) => lines.find((l) => l.text === t);
    for (const [empty, filled] of [
      ["#", "# x"],
      ["##", "## x"],
      ["###", "### x"],
      ["####", "#### x"],
    ]) {
      const a = byText(empty);
      const b = byText(filled);
      ok(a && b, `missing lines for ${empty}`);
      strictEqual(
        Math.round(a.height),
        Math.round(b.height),
        `empty ${JSON.stringify(empty)} is ${a.height}px, filled is ${b.height}px`,
      );
    }
  });

  it("keeps the hanging hash inside its own line, never over the next", async function () {
    const lines = await measure();
    for (const [heading, next] of [
      ["#", "under one"],
      ["##", "under two"],
      ["###", "under three"],
      ["####", "under four"],
    ]) {
      const h = lines.find((l) => l.text === heading);
      const n = lines.find((l) => l.text === next);
      ok(h?.hash, `no hash rendered for ${heading}`);
      ok(
        h.hash.bottom <= h.bottom + 1,
        `${heading}: hash bottom ${h.hash.bottom} spills past its line's bottom ${h.bottom}`,
      );
      ok(
        h.hash.bottom <= n.top + 1,
        `${heading}: hash bottom ${h.hash.bottom} overlaps the next line starting at ${n.top}`,
      );
    }
    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/empty-heading-height.png`);
    }
  });
});
