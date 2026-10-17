// Pinching between one tab and all columns (TAB-09, TAB-10 in
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
});
