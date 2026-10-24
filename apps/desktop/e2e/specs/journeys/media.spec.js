// Rich content journeys (MED in docs/qa/user-journeys.md).
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";
import { invoke, pressKey, waitForTitle, workspaceRoot } from "./_helpers.js";

async function openNote(name) {
  await $("[data-sidebar-surface-content] [data-sidebar-search-button]").click();
  await $("[cmdk-input]").waitForExist({ timeout: 5_000 });
  await browser.execute((value) => {
    const field = document.querySelector("[cmdk-input]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);
  const row = await $(`//*[@cmdk-item][contains(., "${name}")]`);
  await row.waitForExist({ timeout: 5_000 });
  await row.click();
  await waitForTitle(name);
}

/** Where the note's embedded page sits, and what is around it. Running
 *  animations are finished first: the hidden e2e window holds them at their
 *  first frame. `inNote` positions add the note's scroll, because WebDriver's
 *  click scrolls the note a little before it presses the button. */
const embedLayout = () =>
  browser.execute(() => {
    const frame = document.querySelector(".cm-html-embed-frame");
    if (!frame) return null;
    for (const animation of frame.getAnimations()) animation.finish();
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    let scroller = frame.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    const scroll = scroller?.scrollTop ?? 0;
    const below = [...document.querySelectorAll(".cm-line")].find((line) =>
      line.textContent.includes("A line below the page."),
    );
    const button = frame.querySelector(".cm-html-embed-button[aria-pressed]");
    const f = box(frame);
    // What the pointer would hit just inside the frame's top-right corner: a
    // clip on an ancestor would cut the expanded frame off there.
    const hit = document.elementFromPoint(f.right - 20, f.top + 14);
    return {
      expanded: frame.classList.contains("is-expanded"),
      frame: f,
      frameInNote: { ...f, top: f.top + scroll, bottom: f.bottom + scroll },
      scroller: scroller ? box(scroller) : null,
      belowInNote: below ? box(below).top + scroll : null,
      pressed: button?.getAttribute("aria-pressed") ?? null,
      label: button?.getAttribute("aria-label") ?? null,
      cornerInFrame: !!hit && frame.contains(hit),
      loads: Number(frame.querySelector("iframe").dataset.qaLoads ?? "0"),
    };
  });

const near = (a, b, slack = 2) => Math.abs(a - b) <= slack;

describe("Journeys: rich content", () => {
  let root;

  before(async () => {
    root = await workspaceRoot();
  });

  it("MED-08 Expand grows an embedded page over its note, Esc shrinks it back", async () => {
    const notePath = `${root}/Notes/Embed page.md`;
    const before = await invoke("read_file", { path: notePath });
    ok(before.ok, `read_file failed: ${before.error}`);

    await openNote("Embed page");
    // The vault has one embedded page, so it needs no scoping to a column
    // (with one note open there is no focused column to scope to).
    await $(".cm-html-embed-frame iframe[src]").waitForExist({ timeout: 5_000 });
    // Count the page's loads from here on: growing and shrinking must not
    // reload it.
    await browser.execute(() => {
      const iframe = document.querySelector(".cm-html-embed-frame iframe");
      iframe.dataset.qaLoads = "0";
      iframe.addEventListener("load", () => {
        iframe.dataset.qaLoads = String(Number(iframe.dataset.qaLoads) + 1);
      });
    });
    const resting = await embedLayout();
    ok(resting && !resting.expanded, `the page starts in the note: ${JSON.stringify(resting)}`);
    strictEqual(resting.label, "Expand");

    const expand = await $('.cm-html-embed-button[aria-label="Expand"]');
    await expand.waitForExist({ timeout: 5_000 });
    await expand.click();

    const grown = await embedLayout();
    ok(grown.expanded, `Expand grows the page: ${JSON.stringify(grown)}`);
    strictEqual(grown.pressed, "true");
    strictEqual(grown.label, "Shrink back");
    ok(
      near(grown.frame.left, grown.scroller.left + 12) &&
        near(grown.frame.top, grown.scroller.top + 12) &&
        near(grown.frame.right, grown.scroller.right - 12) &&
        near(grown.frame.bottom, grown.scroller.bottom - 12),
      `the page fills the note's area: ${JSON.stringify(grown)}`,
    );
    ok(grown.frame.right - grown.frame.left > resting.frame.right - resting.frame.left);
    ok(grown.cornerInFrame, `nothing clips the grown page: ${JSON.stringify(grown)}`);
    ok(
      near(grown.belowInNote, resting.belowInNote),
      `the text around the page does not move: ${resting.belowInNote} → ${grown.belowInNote}`,
    );

    await pressKey("Escape");
    const back = await embedLayout();
    ok(!back.expanded, `Esc shrinks the page back: ${JSON.stringify(back)}`);
    strictEqual(back.pressed, "false");
    ok(
      near(back.frameInNote.left, resting.frameInNote.left) &&
        near(back.frameInNote.top, resting.frameInNote.top) &&
        near(back.frameInNote.right, resting.frameInNote.right) &&
        near(back.frameInNote.bottom, resting.frameInNote.bottom),
      `the page is back where it was: ${JSON.stringify({ resting, back })}`,
    );
    // The same button shrinks it back too.
    await (await $('.cm-html-embed-button[aria-label="Expand"]')).click();
    ok((await embedLayout()).expanded, "Expand grows it again");
    await (await $('.cm-html-embed-button[aria-label="Shrink back"]')).click();
    const shrunk = await embedLayout();
    ok(!shrunk.expanded && shrunk.pressed === "false", "Shrink back puts it back");
    strictEqual(shrunk.loads, 0, "the page was never reloaded");

    const after = await invoke("read_file", { path: notePath });
    strictEqual(after.value?.content, before.value?.content, "the note's file is unchanged");
    ok(before.value?.content?.includes("![[Notes/assets/page.html|240]]"));
  });
});
