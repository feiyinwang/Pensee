// List journeys (ED-14 in docs/qa/user-journeys.md): the tree rail.
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";
import { mouseClick, pressCmd, typeInEditor, waitForTitle, workspaceRoot } from "./_helpers.js";

/** The front editor's rail paths and the accent's state. */
const railState = () =>
  browser.execute(() => {
    const editor = [...document.querySelectorAll(".cm-editor")].find((el) => el.offsetParent);
    const base = editor?.querySelector(".cm-list-rail");
    const accent = editor?.querySelector(".cm-list-rail-accent");
    return {
      base: base?.getAttribute("d") ?? "",
      accent: accent?.getAttribute("d") ?? "",
      accentShown: Boolean(accent?.classList.contains("is-visible")),
    };
  });

/** Run CodeMirror's pending measure now. It waits for an animation frame,
 *  and a hidden e2e window gets none, so the rail would never be drawn. */
const flushMeasure = () =>
  browser.execute(() => {
    // `EditorView.findFromDOM`, without the module: the content's tile.
    for (const content of document.querySelectorAll(".cm-content")) {
      const view = content.cmTile?.root?.view;
      if (!view) throw new Error("no EditorView behind .cm-content");
      view.measure();
    }
  });

/** Whether this window gets animation frames (a hidden one gets none). */
const framesRun = () =>
  browser.executeAsync((done) => {
    const timer = setTimeout(() => done(false), 300);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      done(true);
    });
  });

/** The caret dot: shown, and its centre. */
const dotState = () =>
  browser.execute(() => {
    const dot = document.querySelector(".cm-list-rail-dot");
    if (!dot) return null;
    const box = dot.getBoundingClientRect();
    return {
      shown: dot.classList.contains("is-visible"),
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      focused: document.hasFocus(),
    };
  });

/** The bullet glyph's slot on the visible list line holding `text`: the
 *  marker column of its prefix mark. */
const markerCentre = (text) =>
  browser.execute((needle) => {
    const line = [...document.querySelectorAll(".cm-line")].find(
      (el) => el.offsetParent && el.textContent.includes(needle),
    );
    const body = line?.querySelector(".cm-list-body")?.getBoundingClientRect();
    return body ? { y: body.top + body.height / 2 } : null;
  }, text);

/** Move the pointer over the body of the visible list line holding `text`. */
const hoverLine = (text) =>
  browser.execute((needle) => {
    const line = [...document.querySelectorAll(".cm-line")].find(
      (el) => el.offsetParent && el.textContent.includes(needle),
    );
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

  it("ED-14 bullets hang on a rail; a nested one curves in; hover lights the path", async function () {
    // Seeded with `- one`, `- two`, `- [ ] a task`.
    await pressCmd("o");
    const input = await $("[cmdk-input]");
    await input.waitForExist({ timeout: 5_000 });
    await input.setValue("Welcome");
    const item = await $('//*[@cmdk-item][contains(., "Welcome")]');
    await item.waitForExist({ timeout: 5_000 });
    await item.click();
    await waitForTitle("Welcome");

    await flushMeasure();
    ok((await railState()).base.startsWith("M"), "a rail under the seeded list");
    ok(!(await railState()).base.includes("A"), "a flat list has no curves");

    // The seed ends in a newline, so the caret sits on the empty last line.
    await typeInEditor("  - nested");
    await flushMeasure();
    ok((await railState()).base.includes("A"), "the nested item gets a curve from its parent");

    await hoverLine("nested");
    let rail = await railState();
    await browser.waitUntil(async () => (rail = await railState()).accentShown, {
      timeout: 2_000,
      timeoutMsg: "hovering the nested item shows no accent",
    });
    ok(rail.accent.includes("A"), "the accent runs through the curve into the nested item");

    // The glide back is eased on animation frames: watch it only when they run.
    if (!(await framesRun())) return;
    await hoverLine("one");
    await browser.waitUntil(async () => !(await railState()).accent.includes("A"), {
      timeout: 2_000,
      timeoutMsg: "the accent does not follow the pointer to the first item",
    });
    strictEqual((await railState()).base.includes("A"), true, "the grey lines stay");
  });

  it("ED-15 the ball sits on the caret's bullet and hops to the hovered one", async function () {
    // Continues from ED-14: the caret is in `nested`; move the pointer off.
    await browser.execute(() =>
      document.querySelector(".cm-content")?.dispatchEvent(new MouseEvent("mouseleave")),
    );
    await flushMeasure();
    const dot = await dotState();
    ok(dot?.shown, "the ball shows on the caret's item");
    const nested = await markerCentre("nested");
    ok(nested && Math.abs(dot.y - nested.y) < 6, "the ball is on the caret's line");

    await hoverLine("one");
    // The hop is a spring on animation frames: a hidden window has none, so
    // it can only be watched landing when frames run.
    if (!(await framesRun())) return;
    const target = await markerCentre("one");
    await browser.waitUntil(async () => Math.abs((await dotState()).y - target.y) < 6, {
      timeout: 5_000,
      timeoutMsg: "the ball did not hop to the hovered bullet",
    });
  });
});
