// The section rail (ED-20…25 in docs/qa/user-journeys.md): one line down the
// pane's right edge, a segment per heading as long as its section, that opens
// the heading list on hover.
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

/** The front pane's line: its segments, the marked one, the list if open. */
const railState = () =>
  browser.execute(() => {
    const pane =
      document.querySelector("[data-column-tab][data-focused] [data-pane]") ??
      [...document.querySelectorAll("[data-pane]")].find((el) => el.offsetParent);
    if (!pane) return null;
    const rail = pane.querySelector('nav[aria-label="On this page"]');
    if (!rail) return { shown: false };
    const content = pane.querySelector(".cm-content");
    const c = content.getBoundingClientRect();
    const textRight = c.right - parseFloat(getComputedStyle(content).paddingRight);
    const r = rail.getBoundingClientRect();
    const segments = [...rail.querySelectorAll(".section-rail-segment")].map((el) => {
      const b = el.getBoundingClientRect();
      return { label: el.getAttribute("aria-label"), top: b.top, height: b.height };
    });
    const active = rail.querySelector(".section-rail-segment[data-active]");
    const rows = [...rail.querySelectorAll(".section-rail-row")].map((el) => el.textContent);
    return {
      shown: true,
      railWidth: r.width,
      railTop: r.top,
      railBottom: r.bottom,
      gapToText: r.left - textRight,
      segments,
      active: active?.getAttribute("aria-label") ?? null,
      rows,
      standingList: pane.querySelector(".section-outline-row") !== null,
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

  it("ED-20 a note with headings shows one line on the right, a segment per heading", async function () {
    await browser.waitUntil(async () => (await railState())?.segments?.length === 8, {
      timeout: 5_000,
      timeoutMsg: "the line never drew a segment per heading",
    });
    const state = await railState();
    strictEqual(state.segments[0].label, "Overview");
    strictEqual(state.active, "Overview", "the first heading is marked at the top of the note");
    strictEqual(state.rows.length, 0, "the list stays closed until hovered");
    ok(state.gapToText > 0, `the line covers no text (gap ${state.gapToText})`);
    // Sections with a ### under them are longer, so their segment is longer.
    const overview = state.segments[0].height;
    const overviewDetails = state.segments[1].height;
    ok(
      overview > overviewDetails,
      `a long section draws a longer segment (${overview} vs ${overviewDetails})`,
    );
    const last = state.segments[state.segments.length - 1];
    ok(
      Math.abs(last.top + last.height - state.railBottom) < 1.5,
      "the segments fill the line to its end",
    );
  });

  it("ED-21 hovering the line opens the list; clicking a heading scrolls the note to it", async function () {
    const scrollTop = () =>
      browser.execute(() => {
        const pane = [...document.querySelectorAll("[data-pane]")].find((el) => el.offsetParent);
        return pane.querySelector('nav[aria-label="On this page"]').previousElementSibling
          .firstElementChild.scrollTop;
      });
    const before = await scrollTop();
    // moveTo sends no pointer events here: React's onMouseEnter is built from
    // mouseover, so send that, coming from the page.
    await browser.execute(() => {
      const pane = [...document.querySelectorAll("[data-pane]")].find((el) => el.offsetParent);
      pane
        .querySelector(".section-rail-segment")
        .dispatchEvent(
          new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }),
        );
    });
    await browser.waitUntil(async () => (await railState()).rows.length === 8, {
      timeout: 5_000,
      timeoutMsg: "hovering the line never opened the list",
    });
    // The rows stack tight, one under the next, not spread out to their segments.
    const pitches = await browser.execute(() => {
      const pane = [...document.querySelectorAll("[data-pane]")].find((el) => el.offsetParent);
      // Layout positions: the hidden window can leave the list mid-entrance,
      // still scaled to 0.97, and a scaled box would read 23px.
      const tops = [...pane.querySelectorAll(".section-rail-row")].map((row) => row.offsetTop);
      return tops.slice(1).map((top, i) => Math.round(top - tops[i]));
    });
    ok(
      pitches.every((pitch) => pitch === 24),
      `rows sit 24px apart: ${pitches.join(", ")}`,
    );
    const row = await $('//nav[@aria-label="On this page"]//button[contains(., "Wrapping up")]');
    await row.click();
    // The hidden e2e window runs no frames after a scroll, so CodeMirror may
    // never draw the heading's line, the mark can't move to the clicked row
    // (ED-24) and the landing keeps CodeMirror's height guess: check the jump.
    await browser.waitUntil(async () => (await scrollTop()) > before + 1000, {
      timeout: 10_000,
      timeoutMsg: "the note never scrolled down to the clicked heading",
    });
  });

  it("ED-22 the line stays a line at every page width; nothing stands in the margin", async function () {
    for (const width of ["280px", "1000px"]) {
      await setPageWidth(width);
      const state = await railState();
      ok(state.shown, `the line shows at page width ${width}`);
      strictEqual(state.segments.length, 8);
      strictEqual(state.standingList, false, `no standing list at page width ${width}`);
      ok(state.railWidth <= 24, `the line keeps to the edge (${state.railWidth}px)`);
    }
  });

  it("ED-23 scrolling with the pointer over the line scrolls the note", async function () {
    const scrolled = await browser.execute(() => {
      const pane = [...document.querySelectorAll("[data-pane]")].find((el) => el.offsetParent);
      const rail = pane.querySelector('nav[aria-label="On this page"]');
      const scroller = rail.previousElementSibling.firstElementChild;
      scroller.scrollTop = 0;
      const before = scroller.scrollTop;
      rail.dispatchEvent(new WheelEvent("wheel", { deltaY: 300, bubbles: true, cancelable: true }));
      return { before, after: scroller.scrollTop };
    });
    ok(
      scrolled.after > scrolled.before,
      `the note scrolled (${scrolled.before} → ${scrolled.after})`,
    );
  });

  it("ED-25 in a video note, the line starts under the video", async function () {
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
    const place = () =>
      browser.execute(() => {
        const pane = [...document.querySelectorAll("[data-pane]")].find((el) => el.offsetParent);
        const rail = pane?.querySelector('nav[aria-label="On this page"]');
        const band = pane?.querySelector(".video-band");
        if (!rail || !band) return null;
        return {
          railTop: rail.getBoundingClientRect().top,
          bandBottom: band.getBoundingClientRect().bottom,
        };
      });
    await browser.waitUntil(async () => (await place()) !== null, {
      timeout: 15_000,
      timeoutMsg: "no line beside the video note",
    });
    let state = await place();
    ok(
      state.railTop >= state.bandBottom,
      `the line starts under the video (${state.railTop} < ${state.bandBottom})`,
    );
    // Scrolled to the bottom, the band sticks at the top and the line starts
    // under it still.
    await browser.execute(() => {
      const pane = [...document.querySelectorAll("[data-pane]")].find((el) => el.offsetParent);
      const scroller = pane.querySelector(".video-band").parentElement;
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event("scroll"));
    });
    state = await place();
    ok(
      state.railTop >= state.bandBottom,
      `stuck band: the line starts under it (${state.railTop} < ${state.bandBottom})`,
    );
  });
});
