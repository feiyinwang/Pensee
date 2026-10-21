// Pinching between one tab and all columns (TAB-09…11 in
// docs/qa/user-journeys.md). A pinch reaches the page as Ctrl-wheel events;
// the journeys send those, since the driver has no trackpad.
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { deepEqual, ok } from "node:assert/strict";
import { waitForTitle, workspaceRoot } from "./_helpers.js";

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

/** Small pinch steps over the Long essay column, as a trackpad sends them
 *  (out is negative), then the strip's layout and where each H1–H6 label
 *  sits against its heading, read in the same task as the last step: no
 *  frame has run, so this is what the next paint shows. */
const pinch = (steps) =>
  browser.execute((deltas) => {
    const column = [...document.querySelectorAll(".tab-column:not([data-hidden])")].find((el) =>
      el.querySelector(".cm-heading-line"),
    );
    const target = column.querySelector(".cm-content");
    const box = target.getBoundingClientRect();
    for (const deltaY of deltas) {
      target.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY,
          clientX: box.left + 40,
          clientY: box.top + 40,
        }),
      );
    }
    const editor = [...document.querySelectorAll(".tab-column:not([data-hidden]) .cm-editor")].find(
      (el) => el.querySelector(".cm-heading-line"),
    );
    const lines = [...editor.querySelectorAll(".cm-content .cm-heading-line")];
    const labels = [...editor.querySelectorAll(".wr-heading-level")];
    const off = labels
      .map((label, i) => {
        const line = lines[i]?.getBoundingClientRect();
        const mid = (r) => r.top + r.height / 2;
        const l = label.getBoundingClientRect();
        // In the margin just left of the heading's line, level with it.
        const beside = l.right <= line.left + 8 && l.right >= line.left - 60;
        return line && (mid(l) < line.top || mid(l) > line.bottom || !beside)
          ? `${label.textContent} #${i}: label at ${Math.round(l.left)},${Math.round(mid(l))}; ` +
              `heading at ${Math.round(line.left)},${Math.round(line.top)}–${Math.round(line.bottom)}`
          : null;
      })
      .filter(Boolean);
    return {
      columns: document.querySelector(".tab-columns").hasAttribute("data-columns"),
      labels: labels.length,
      off,
    };
  }, steps);

describe("Journeys: tabs", function () {
  before(async function () {
    await workspaceRoot();
    await openViaSearch("Pinch hub");
    await $(".cm-wiki-link*=Long essay").waitForExist({ timeout: 10_000 });
    await browser.execute(() => {
      const link = [...document.querySelectorAll(".cm-wiki-link")].find(
        (el) => el.textContent === "Long essay",
      );
      const r = link.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, button: 0, clientX: r.left + 4 };
      for (const type of ["mousedown", "mouseup", "click"]) {
        link.dispatchEvent(new MouseEvent(type, { ...at, clientY: r.top + r.height / 2 }));
      }
    });
    // Its heading lines, not their labels: CodeMirror places the labels on an
    // animation frame, which the hidden e2e window barely runs. The pinch's
    // own measure places them, which is what TAB-09 checks.
    await browser
      .waitUntil(
        async () =>
          browser.execute(
            () =>
              document.querySelectorAll(".tab-columns[data-columns] .cm-heading-line").length > 0,
          ),
        { timeout: 10_000, timeoutMsg: "Long essay never opened as a column with its headings" },
      )
      .catch(async (error) => {
        console.log(
          "DEBUG tabs",
          await browser.execute(() => ({
            columns: document.querySelectorAll(".tab-column").length,
            strip: document.querySelector(".tab-columns")?.outerHTML.slice(0, 300),
            links: [...document.querySelectorAll(".cm-wiki-link")].map((el) => el.textContent),
            headings: document.querySelectorAll(".cm-heading-line").length,
          })),
        );
        throw error;
      });
  });

  // A gesture ends after a quiet gap; each journey starts a new one.
  beforeEach(() => browser.pause(300));

  it("TAB-09 a pinch out on a column shows it alone at once, its heading labels in place", async function () {
    const after = await pinch([-4, -4, -4]);
    ok(!after.columns, "three small pinch steps out should show one tab");
    ok(after.labels > 0, "the note's heading labels should show");
    deepEqual(after.off, [], "every heading label should sit beside its heading in that frame");
  });

  it("TAB-10 pinching back in within the same gesture brings the columns back", async function () {
    // Starts on the one tab TAB-09 left.
    const early = await pinch([4]);
    ok(!early.columns, "one small step in should not switch yet");
    const columns = await pinch([4, 4]);
    ok(columns.columns, "three small steps in should show the columns");
    const alone = await pinch([-4, -4, -4]);
    ok(!alone.columns, "pinching out in the same gesture should show one tab again");
    const back = await pinch([4, 4, 4]);
    ok(back.columns, "and pinching in again, the columns");
    deepEqual(back.off, [], "every heading label should sit beside its heading in that frame");
  });

  it("TAB-11 a pinch to one tab and back keeps every column's page where it was", async function () {
    // Starts on the columns TAB-10 left. Hidden and off-screen tabs are
    // skipped by the renderer (content-visibility), which must not lose
    // their scroll or their text.
    const scrollerOf = (title) =>
      browser.execute((name) => {
        const column = [...document.querySelectorAll(".tab-column")].find(
          (el) => el.querySelector(".tab-column-title")?.textContent === name,
        );
        const scroller = [...column.querySelectorAll("*")].find(
          (el) =>
            el.scrollHeight > el.clientHeight + 100 && getComputedStyle(el).overflowY !== "visible",
        );
        scroller.dataset.qaScroller = name;
        return true;
      }, title);
    await scrollerOf("Long essay.md");
    const place = await browser.execute(() => {
      const scroller = document.querySelector('[data-qa-scroller="Long essay.md"]');
      scroller.scrollTop = 3000;
      return scroller.scrollTop;
    });
    ok(place > 2000, "the long note should scroll down");
    // Out on the hub, so the long note is hidden; then back in.
    const pinchOn = (deltaY) =>
      browser.execute((dy) => {
        // The hub is the column without headings.
        const hub = [...document.querySelectorAll(".tab-column")].find(
          (el) => !el.querySelector(".cm-heading-line"),
        );
        const target = hub.querySelector(".cm-content");
        const box = target.getBoundingClientRect();
        for (let i = 0; i < 3; i++) {
          target.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              ctrlKey: true,
              deltaY: dy,
              clientX: box.left + 40,
              clientY: box.top + 40,
            }),
          );
        }
        return document.querySelector(".tab-columns").hasAttribute("data-columns");
      }, deltaY);
    ok(!(await pinchOn(-4)), "pinching out on the hub should show it alone");
    const hidden = await browser.execute(
      () =>
        document.querySelector('[data-qa-scroller="Long essay.md"]').closest("[data-hidden]") !==
        null,
    );
    ok(hidden, "the long note should be hidden behind the hub");
    await browser.pause(300);
    ok(await pinchOn(4), "pinching in should bring the columns back");
    const after = await browser.execute(() => {
      const scroller = document.querySelector('[data-qa-scroller="Long essay.md"]');
      const view = scroller.getBoundingClientRect();
      const shown = [...scroller.querySelectorAll(".cm-line")].filter((line) => {
        const r = line.getBoundingClientRect();
        return r.height > 0 && r.bottom > view.top && r.top < view.bottom;
      });
      return { top: scroller.scrollTop, lines: shown.length, text: shown[0]?.textContent ?? "" };
    });
    ok(
      Math.abs(after.top - place) < 2,
      `the long note should stay at ${place}px, not ${after.top}px`,
    );
    ok(after.lines > 0, "the long note's lines in view should be laid out");
  });

  it("TAB-12 ⌘O into a column scrolled out of view brings it back into view", async function () {
    // Starts on the columns TAB-11 left. Two more columns so the strip is
    // wider than the window.
    for (const name of ["Outline tour", "On writing"]) {
      await browser.execute((title) => {
        const link = [...document.querySelectorAll(".cm-wiki-link")].find(
          (el) => el.textContent === title,
        );
        const r = link.getBoundingClientRect();
        const at = { bubbles: true, cancelable: true, button: 0, clientX: r.left + 4 };
        for (const type of ["mousedown", "mouseup", "click"]) {
          link.dispatchEvent(new MouseEvent(type, { ...at, clientY: r.top + r.height / 2 }));
        }
      }, name);
      await waitForTitle(name, 10_000);
    }
    const scrollable = await browser.execute(() => {
      const strip = document.querySelector(".tab-columns[data-columns]");
      return strip !== null && strip.scrollWidth > strip.clientWidth + 100;
    });
    if (!scrollable) this.skip();

    // Press into the hub to make it the active column, then scroll the strip
    // to its far end so the hub is out of view. The hidden window never runs
    // a smooth scroll, so the strip's scrollTo lands at once here.
    const outOfView = await browser.execute(() => {
      const strip = document.querySelector(".tab-columns[data-columns]");
      strip.scrollTo = (options) =>
        Element.prototype.scrollTo.call(strip, { ...options, behavior: "auto" });
      const hub = [...document.querySelectorAll(".tab-column")].find(
        (el) => el.querySelector(".tab-column-title")?.textContent === "Pinch hub.md",
      );
      hub.dataset.qaHub = "";
      hub
        .querySelector(".tab-column-body")
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      strip.scrollLeft = strip.scrollWidth;
      const view = strip.getBoundingClientRect();
      const box = hub.getBoundingClientRect();
      return box.right <= view.left || box.left >= view.right;
    });
    ok(outOfView, "the hub's column should be scrolled out of view");

    await openViaSearch("Welcome");
    const shown = await browser.execute(() => {
      const strip = document.querySelector(".tab-columns[data-columns]");
      const column = document.querySelector("[data-qa-hub]");
      const view = strip.getBoundingClientRect();
      const box = column.getBoundingClientRect();
      return {
        focused: column.hasAttribute("data-focused"),
        title: column.querySelector(".tab-column-title")?.textContent,
        inView: box.left >= view.left - 1 && box.right <= view.right + 1,
      };
    });
    ok(shown.focused, "the hub's column should still be the active one");
    ok(shown.title?.startsWith("Welcome"), `the column should show Welcome, not ${shown.title}`);
    ok(shown.inView, "the column ⌘O opened Welcome in should be scrolled fully into view");
  });
});
