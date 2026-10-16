// The standing outline (ED-20…22 in docs/qa/user-journeys.md): when the
// margin right of the text has room, the section rail shows every heading as
// an "On this page" list instead of ticks behind a hover.
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";
import { invoke, waitForTitle, workspaceRoot } from "./_helpers.js";

/** Open a note through the sidebar's Search field (SB-07), the way PERF does,
 *  so the journey doesn't hang on which key opens search. */
async function openViaSearch(name) {
  await $("[data-sidebar-surface-content] [data-sidebar-search-button]").click();
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue(name);
  const item = await $(`//*[@cmdk-item][contains(., "${name}")]`);
  await item.waitForExist({ timeout: 5_000 });
  await item.click();
  await waitForTitle(name);
}

/** The e2e window is a fixed 1200px, so the margin is set through the page
 *  width the editor reads (as a page-width preset would) rather than by
 *  resizing the window. */
const setPageWidth = (px) =>
  browser.execute((value) => {
    document.documentElement.style.setProperty("--pensee-editor-max-width", value);
  }, px);

/** The front pane's outline: its rows, the marked one, and where it sits. */
const outlineState = () =>
  browser.execute(() => {
    const pane =
      document.querySelector("[data-column-tab][data-focused] [data-pane]") ??
      [...document.querySelectorAll("[data-pane]")].find((el) => el.offsetParent);
    if (!pane) return null;
    const nav = pane.querySelector('nav[aria-label="On this page"]');
    const ticks = pane.querySelectorAll(".section-rail-tick").length;
    if (!nav) return { shown: false, ticks };
    const content = pane.querySelector(".cm-content");
    const c = content.getBoundingClientRect();
    const textRight = c.right - parseFloat(getComputedStyle(content).paddingRight);
    const rows = [...nav.querySelectorAll(".section-outline-row")];
    const active = nav.querySelector(".section-outline-row.is-active");
    const marker = nav.querySelector(".section-outline-marker");
    return {
      shown: true,
      ticks,
      title: nav.querySelector(".section-outline-title")?.textContent,
      rows: rows.map((row) => row.textContent),
      active: active?.textContent ?? null,
      gapToText: nav.getBoundingClientRect().left - textRight,
      markerTop: marker?.getBoundingClientRect().top ?? null,
      activeTop: active?.getBoundingClientRect().top ?? null,
    };
  });

describe("Journeys: outline", function () {
  before(async function () {
    await workspaceRoot();
    await openViaSearch("Outline tour");
    await browser.execute(() => {
      const style = document.createElement("style");
      style.textContent = "*{transition:none!important}";
      document.head.append(style);
    });
  });

  after(async function () {
    await browser.execute(() =>
      document.documentElement.style.removeProperty("--pensee-editor-max-width"),
    );
  });

  it("ED-20 with room beside the page, every heading stands listed under On this page", async function () {
    await setPageWidth("280px");
    await browser.waitUntil(async () => (await outlineState())?.shown, {
      timeout: 5_000,
      timeoutMsg: "the outline never opened with a wide margin",
    });
    const state = await outlineState();
    strictEqual(state.title, "On this page");
    strictEqual(state.ticks, 0, "the ticks give way to the outline");
    strictEqual(state.rows.length, 8, `every heading is a row: ${state.rows.join(" | ")}`);
    strictEqual(state.rows[0], "Overview");
    strictEqual(state.active, "Overview", "the first heading is marked at the top of the note");
    ok(state.gapToText >= 40, `the outline keeps 40px off the text (got ${state.gapToText})`);
    ok(Math.abs(state.markerTop - state.activeTop) < 1, "the marker sits on the marked row");
  });

  it("ED-21 clicking a heading in On this page scrolls the note to it", async function () {
    await setPageWidth("280px");
    const scrolled = () =>
      browser.execute(() => {
        const pane = [...document.querySelectorAll("[data-pane]")].find((el) => el.offsetParent);
        const scroller = pane.querySelector('nav[aria-label="On this page"]').previousElementSibling
          .firstElementChild;
        return { scrollTop: scroller.scrollTop };
      });
    const before = await scrolled();
    const row = await $('//nav[@aria-label="On this page"]//button[contains(., "Wrapping up")]');
    await row.waitForExist({ timeout: 5_000 });
    await row.click();
    // The hidden e2e window runs no frames after a scroll, so CodeMirror may
    // never draw the heading's line, the mark can't move to the clicked row
    // (ED-24) and the landing keeps CodeMirror's height guess: check the jump.
    await browser.waitUntil(async () => (await scrolled()).scrollTop > before.scrollTop + 1000, {
      timeout: 10_000,
      timeoutMsg: "the note never scrolled down to the clicked heading",
    });
  });

  it("ED-23 scrolling with the pointer over On this page scrolls the note", async function () {
    await setPageWidth("280px");
    await $('nav[aria-label="On this page"]').waitForExist({ timeout: 5_000 });
    const scrolled = await browser.execute(() => {
      const pane = [...document.querySelectorAll("[data-pane]")].find((el) => el.offsetParent);
      const nav = pane.querySelector('nav[aria-label="On this page"]');
      const scroller = nav.previousElementSibling.firstElementChild;
      scroller.scrollTop = 0;
      const before = scroller.scrollTop;
      nav.dispatchEvent(new WheelEvent("wheel", { deltaY: 300, bubbles: true, cancelable: true }));
      return { before, after: scroller.scrollTop };
    });
    ok(
      scrolled.after > scrolled.before,
      `the note scrolled (${scrolled.before} → ${scrolled.after})`,
    );
  });

  it("ED-22 without room beside the page, the outline folds back into ticks", async function () {
    await setPageWidth("1000px");
    await browser.waitUntil(async () => (await outlineState())?.shown === false, {
      timeout: 5_000,
      timeoutMsg: "the outline stayed open with no margin for it",
    });
    const state = await outlineState();
    strictEqual(state.ticks, 8, "one tick per heading");
  });

  it("ED-25 in a video note, On this page starts under the video, beside the text", async function () {
    // The seeded video note, given headings before it opens (a fresh vault per
    // spec file, so no other journey sees them).
    const root = await workspaceRoot();
    const path = `${root}/Speech talk.md`;
    const read = await invoke("read_file", { path });
    ok(read.ok, `read_file failed: ${read.error}`);
    const text = typeof read.value === "string" ? read.value : read.value.content;
    const wrote = await invoke("write_file", {
      path,
      content: `${text}\n## Motor act\n\nSyllables.\n\n## Listening first\n\nBabble.\n`,
    });
    ok(wrote.ok, `write_file failed: ${wrote.error}`);
    await openViaSearch("Speech talk");
    await setPageWidth("280px");
    const place = () =>
      browser.execute(() => {
        const pane = [...document.querySelectorAll("[data-pane]")].find((el) => el.offsetParent);
        const nav = pane?.querySelector('nav[aria-label="On this page"]');
        const band = pane?.querySelector(".video-band");
        if (!nav || !band) return null;
        const n = nav.getBoundingClientRect();
        const b = band.getBoundingClientRect();
        const scroller = band.parentElement;
        return {
          navTop: n.top,
          navBottom: n.bottom,
          bandBottom: b.bottom,
          scroller: scroller.scrollTop,
        };
      });
    await browser.waitUntil(async () => (await place()) !== null, {
      timeout: 15_000,
      timeoutMsg: "no outline beside the video note",
    });
    let state = await place();
    ok(
      state.navTop >= state.bandBottom,
      `the outline starts under the video (${state.navTop} < ${state.bandBottom})`,
    );
    // Scrolled to the bottom, the band sticks at the top and the outline sits
    // under it still.
    await browser.execute(() => {
      const pane = [...document.querySelectorAll("[data-pane]")].find((el) => el.offsetParent);
      const scroller = pane.querySelector(".video-band").parentElement;
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event("scroll"));
    });
    state = await place();
    ok(
      state.navTop >= state.bandBottom,
      `stuck band: the outline starts under it (${state.navTop} < ${state.bandBottom})`,
    );
  });
});
