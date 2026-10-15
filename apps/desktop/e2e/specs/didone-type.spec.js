import { ok, strictEqual } from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Didone display type (SPECs/didone-display-type-spec.md): the page title,
// H1–H2 and space titles are Bodoni Moda at regular weight, loaded from the
// app bundle; chrome labels are tracked capitals, never monospace; the
// sidebar carries the PENSÉE wordmark.
// Screenshots go to DIDONE_SHOTS (default: the OS temp dir).
//
// Requires a restorable workspace; self-skips without one.
describe("Didone display type", function () {
  const STEM = "didone-type-e2e";
  const SHOTS = process.env.DIDONE_SHOTS ?? tmpdir();
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
    writeFileSync(
      filePath,
      [
        "# The thick and the thin",
        "",
        "Body text stays in the system face, with **bold** where you ask for it.",
        "",
        "## Hairlines and stems",
        "",
        "A second paragraph under the H2.",
        "",
        "### A third-level heading",
        "",
        "Still the system face.",
        "",
      ].join("\n"),
    );
    await browser.refresh();
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 15_000 });
    // Files live in the Files space, not the sidebar.
    await $('[data-space-key="files"]').click();
    const item = await $(`span*=${STEM}`);
    await item.waitForExist({ timeout: 15_000 });
    await item.click();
    await browser.waitUntil(
      async () => (await $(".cm-content").getText()).includes("A third-level heading"),
      { timeout: 10_000 },
    );
    await browser.executeAsync((done) => {
      void document.fonts.ready.then(() => done(null));
    });
    await browser.pause(400);
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(function () {
    if (filePath) rmSync(filePath, { force: true });
  });

  /** Computed type of the element holding `text` (deepest match). */
  async function typeOf(selector, text) {
    return browser.execute(
      (sel, needle) => {
        const hosts = [...document.querySelectorAll(sel)].filter((el) =>
          (el.textContent ?? "").includes(needle),
        );
        const host = hosts.at(-1);
        if (!host) return null;
        // The innermost element whose own text node holds the needle.
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        let el = host;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if ((n.nodeValue ?? "").includes(needle.slice(0, 6))) {
            el = n.parentElement;
            break;
          }
        }
        const cs = getComputedStyle(el);
        return {
          family: cs.fontFamily,
          weight: cs.fontWeight,
          transform: cs.textTransform,
          tracking: cs.letterSpacing,
        };
      },
      selector,
      text,
    );
  }

  it("loads Bodoni Moda from the app bundle", async function () {
    const loaded = await browser.execute(() =>
      [...document.fonts]
        .filter((f) => f.family.replaceAll('"', "") === "Bodoni Moda Variable")
        .map((f) => f.status),
    );
    ok(loaded.includes("loaded"), `Bodoni Moda faces: ${JSON.stringify(loaded)}`);
  });

  it("sets the page title, H1 and H2 in Bodoni Moda at regular weight", async function () {
    const title = await typeOf(".page-title", "");
    ok(title?.family.includes("Bodoni Moda"), `page title: ${title?.family}`);
    strictEqual(title?.weight, "400");

    for (const text of ["The thick and the thin", "Hairlines and stems"]) {
      const heading = await typeOf(".cm-line", text);
      ok(heading?.family.includes("Bodoni Moda"), `${text}: ${heading?.family}`);
      strictEqual(heading?.weight, "400", text);
    }

    const h3 = await typeOf(".cm-line", "A third-level heading");
    ok(!h3?.family.includes("Bodoni"), `H3 stays the text face: ${h3?.family}`);
    const body = await typeOf(".cm-line", "Body text stays");
    ok(!body?.family.includes("Bodoni"), `body stays the text face: ${body?.family}`);

    await browser.saveScreenshot(join(SHOTS, "didone-note.png"));
  });

  it("sets sidebar labels in sentence case, not monospace", async function () {
    const labels = await browser.execute(() =>
      [...document.querySelectorAll("[data-sidebar-surface] .label-ui")].map((el) => {
        const cs = getComputedStyle(el);
        return { text: el.textContent, family: cs.fontFamily, transform: cs.textTransform };
      }),
    );
    ok(labels.length > 0, "sidebar has section labels");
    for (const label of labels) {
      ok(!/mono|menlo|courier/i.test(label.family), `${label.text}: ${label.family}`);
      strictEqual(label.transform, "none", label.text);
    }
  });

  it("sets a space title in Bodoni Moda", async function () {
    await $('[data-space-key="projects"]').click();
    const heading = await $("h1=Projects");
    await heading.waitForExist({ timeout: 10_000 });
    // Let the tab's slide-in settle before the screenshot.
    await browser.pause(1_500);
    const title = await typeOf("h1", "Projects");
    ok(title?.family.includes("Bodoni Moda"), `space title: ${title?.family}`);
    strictEqual(title?.weight, "400");
    await browser.saveScreenshot(join(SHOTS, "didone-projects.png"));
  });

  it("sets command-palette group headings in sentence case, not monospace", async function () {
    await browser.execute(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "p", metaKey: true, bubbles: true, cancelable: true }),
      );
    });
    const heading = await $("[cmdk-group-heading]");
    await heading.waitForExist({ timeout: 5_000 });
    await browser.pause(300);
    const type = await browser.execute(() => {
      const cs = getComputedStyle(document.querySelector("[cmdk-group-heading]"));
      return { family: cs.fontFamily, transform: cs.textTransform };
    });
    ok(!/mono|menlo|courier/i.test(type.family), `palette heading: ${type.family}`);
    strictEqual(type.transform, "none");
    await browser.saveScreenshot(join(SHOTS, "didone-palette.png"));
    await browser.keys("Escape");
  });
});
