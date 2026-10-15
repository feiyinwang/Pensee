// List journeys (ED-14, ED-15 in docs/qa/user-journeys.md): the list guides.
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";
import { pressCmd, typeInEditor, waitForTitle, workspaceRoot } from "./_helpers.js";

/** The front editor's guide paths, and which one is darkened. */
const guideState = () =>
  browser.execute(() => {
    const editor = [
      ...(document.querySelector("[data-column-tab][data-focused]") ?? document).querySelectorAll(
        ".cm-editor",
      ),
    ].find((el) => el.offsetParent);
    const guides = [...(editor?.querySelectorAll(".cm-list-guide") ?? [])];
    return {
      paths: guides.map((g) => g.getAttribute("d") ?? ""),
      active: guides.filter((g) => g.classList.contains("is-active")).length,
    };
  });

/** Vertical extent of the visible line holding `text`, in the guide layer's
 *  space (the layer sits at the scroller's origin). */
const lineSpan = (text) =>
  browser.execute((needle) => {
    const line = [
      ...(document.querySelector("[data-column-tab][data-focused]") ?? document).querySelectorAll(
        ".cm-line",
      ),
    ].find((el) => el.offsetParent && el.textContent.includes(needle));
    if (!line) throw new Error(`no line with ${needle}`);
    const scroller = line.closest(".cm-scroller");
    const top = line.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    return { top: top + scroller.scrollTop, bottom: top + scroller.scrollTop + line.offsetHeight };
  }, text);

/** Each guide's runs as [y0, y1] pairs, read back from its path. */
const runs = (d) => [...d.matchAll(/M[\d.]+ ([\d.]+)V([\d.]+)/g)].map((m) => [+m[1], +m[2]]);

/** Run CodeMirror's pending measure now. It waits for an animation frame,
 *  and a hidden e2e window gets none, so the guides would never be drawn. */
const flushMeasure = () =>
  browser.execute(() => {
    // `EditorView.findFromDOM`, without the module: the content's tile.
    for (const content of document.querySelectorAll(".cm-content")) {
      const view = content.cmTile?.root?.view;
      if (!view) throw new Error("no EditorView behind .cm-content");
      view.measure();
    }
  });

/** Move the pointer over the body of the visible list line holding `text`. */
const hoverLine = (text) =>
  browser.execute((needle) => {
    const line = [
      ...(document.querySelector("[data-column-tab][data-focused]") ?? document).querySelectorAll(
        ".cm-line",
      ),
    ].find((el) => el.offsetParent && el.textContent.includes(needle));
    const body = line?.querySelector(".cm-list-body");
    if (!line || !body) throw new Error(`no list line with ${needle}`);
    const box = body.getBoundingClientRect();
    const at = { bubbles: true, clientX: box.left + 4, clientY: box.top + box.height / 2 };
    line.dispatchEvent(new MouseEvent("mousemove", at));
  }, text);

describe("Journeys: lists", function () {
  before(async function () {
    await workspaceRoot();
  });

  it("ED-14 a nested list gets one straight guide; hovering its parent darkens it", async function () {
    // Seeded with `- one`, `- two`, `- [ ] a task`.
    await pressCmd("f");
    const input = await $("[cmdk-input]");
    await input.waitForExist({ timeout: 5_000 });
    await input.setValue("Welcome");
    const item = await $('//*[@cmdk-item][contains(., "Welcome")]');
    await item.waitForExist({ timeout: 5_000 });
    await item.click();
    await waitForTitle("Welcome");

    await flushMeasure();
    strictEqual((await guideState()).paths.length, 0, "a flat list has no guides");

    // The seed ends in a newline, so the caret sits on the empty last line.
    await typeInEditor("  - nested");
    await flushMeasure();
    const { paths } = await guideState();
    strictEqual(paths.length, 1, "the nested list gets one guide");
    ok(
      /^M[\d.]+ [\d.]+V[\d.]+$/.test(paths[0] ?? ""),
      `the guide is one straight line: ${paths[0]}`,
    );

    // The nested item hangs from the seeded task: hovering the task darkens
    // its guide; the nested item has no children, so hovering it clears it.
    await hoverLine("a task");
    await browser.waitUntil(async () => (await guideState()).active === 1, {
      timeout: 2_000,
      timeoutMsg: "hovering the parent does not darken the guide hanging from it",
    });

    await hoverLine("nested");
    await browser.waitUntil(async () => (await guideState()).active === 0, {
      timeout: 2_000,
      timeoutMsg: "hovering a childless item still darkens a guide",
    });
  });

  it("ED-15 a line outside the list's indent cuts the guides it would cross", async function () {
    // ED-14 left `- one`, `- two`, `- [ ] a task`, `  - nested`. A line with
    // no marker right under it is a lazy continuation: inside the list, but
    // drawn from the content edge.
    await typeInEditor("\nplain words here\n  - after");
    await flushMeasure();
    const { paths } = await guideState();
    strictEqual(paths.length, 1, `one guide, under the task: ${paths.join(" | ")}`);
    const plain = await lineSpan("plain words here");
    const segments = runs(paths[0] ?? "");
    strictEqual(segments.length, 2, `the guide is cut in two: ${paths[0]}`);
    for (const [y0, y1] of segments) {
      ok(
        y1 <= plain.top || y0 >= plain.bottom,
        `run ${y0}–${y1} crosses ${plain.top}–${plain.bottom}`,
      );
    }
  });
});
