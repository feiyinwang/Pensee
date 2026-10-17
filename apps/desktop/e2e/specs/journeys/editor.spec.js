// Editor journeys (ED in docs/qa/user-journeys.md) beyond the smoke set.
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";
import {
  invoke,
  mouseClick,
  pressCmd,
  typeInEditor,
  waitForTitle,
  workspaceRoot,
} from "./_helpers.js";

/** Open a note by name through ⌘F, the way PAL-01 does. */
async function openViaPalette(name) {
  await pressCmd("f");
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue(name);
  const item = await $(`//*[@cmdk-item][contains(., "${name}")]`);
  await item.waitForExist({ timeout: 5_000 });
  await item.click();
  await waitForTitle(name);
}

/** The front note's title and properties toggle boxes, and the toggle's state. */
const headerLayout = () =>
  browser.execute(() => {
    const title = [
      ...(document.querySelector("[data-column-tab][data-focused]") ?? document).querySelectorAll(
        "[data-page-title]",
      ),
    ].find((el) => el.offsetParent);
    const toggle = [...document.querySelectorAll(".page-header-toggle")].find(
      (el) => el.offsetParent,
    );
    if (!title || !toggle) return null;
    const t = title.getBoundingClientRect();
    const g = toggle.getBoundingClientRect();
    const panelId = toggle.getAttribute("aria-controls");
    return {
      text: toggle.textContent.trim(),
      titleLeft: t.left,
      titleBottom: t.bottom,
      toggleLeft: g.left,
      toggleTop: g.top,
      expanded: toggle.getAttribute("aria-expanded"),
      panelShown: Boolean(panelId && document.getElementById(panelId)),
    };
  });

/** The front note's task box and whether a check celebration is playing. */
const taskState = () =>
  browser.execute(() => {
    const box = [...document.querySelectorAll(".cm-list-prefix-task")].find(
      (el) => el.offsetParent,
    );
    const layer = document.querySelector(".cm-task-celebration");
    return {
      checked: Boolean(box?.classList.contains("cm-list-prefix-task-checked")),
      dots: layer ? layer.children.length : 0,
      boxAnimations: box ? box.getAnimations({ subtree: true }).length : 0,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  });

describe("Journeys: editor", function () {
  before(async function () {
    await workspaceRoot();
  });

  it("ED-03 N properties › sits under the title at its left edge, and opens and folds", async function () {
    // Seeded with Type and Status.
    await openViaPalette("Old idea");

    await $(".page-header-toggle").waitForExist({ timeout: 5_000 });
    let layout = await headerLayout();
    ok(layout, "the title and its properties toggle show");
    strictEqual(layout.text, "2 properties");
    ok(
      layout.toggleTop >= layout.titleBottom - 1,
      `toggle under the title (toggle top ${layout.toggleTop}, title bottom ${layout.titleBottom})`,
    );
    ok(
      Math.abs(layout.toggleLeft - layout.titleLeft) <= 1,
      `toggle left-aligned with the title (${layout.toggleLeft} vs ${layout.titleLeft})`,
    );
    strictEqual(layout.expanded, "false");
    strictEqual(layout.panelShown, false, "properties folded by default");

    await mouseClick(await $(".page-header-toggle"));
    await browser.waitUntil(async () => (await headerLayout())?.panelShown === true, {
      timeout: 3_000,
      timeoutMsg: "clicking the toggle opens the properties",
    });
    strictEqual((await headerLayout()).expanded, "true");

    await mouseClick(await $(".page-header-toggle"));
    await browser.waitUntil(async () => (await headerLayout())?.panelShown === false, {
      timeout: 3_000,
      timeoutMsg: "clicking the toggle again folds the properties",
    });
    layout = await headerLayout();
    strictEqual(layout.expanded, "false");
  });

  it("ED-13 checking a task celebrates once; unchecking is still", async function () {
    // Seeded with `- [ ] a task`.
    await openViaPalette("Welcome");
    // Function selectors aren't supported: tag the visible box, select that.
    const box = async () => {
      await browser.execute(() => {
        document.querySelector("[data-qa-task]")?.removeAttribute("data-qa-task");
        [...document.querySelectorAll(".cm-list-prefix-task")]
          .find((el) => el.offsetParent)
          ?.setAttribute("data-qa-task", "");
      });
      return $("[data-qa-task]");
    };
    await $(".cm-list-prefix-task").waitForExist({ timeout: 5_000 });
    strictEqual((await taskState()).checked, false, "the seeded task starts unchecked");

    await mouseClick(await box());
    // The burst starts on CodeMirror's next measure frame, which a window
    // that isn't in front gets late: wait for it rather than read at once.
    let checked = await taskState();
    strictEqual(checked.checked, true, "the click checks the task");
    if (checked.reducedMotion) {
      await browser.pause(600);
      strictEqual((await taskState()).dots, 0, "no burst under reduced motion");
    } else {
      await browser.waitUntil(async () => (checked = await taskState()).dots > 0, {
        timeout: 2_000,
        timeoutMsg: "no burst after checking the task",
      });
      strictEqual(checked.dots, 6, "six dots burst from the box");
      ok(checked.boxAnimations >= 3, "the box pops and the tick draws in");
    }
    // The e2e window is hidden, so WebKit's animation clock stands still:
    // finish the running animations to stand in for the half second passing.
    await browser.execute(() => document.getAnimations().forEach((a) => a.finish()));
    await browser.waitUntil(async () => (await taskState()).dots === 0, {
      timeout: 2_000,
      timeoutMsg: "the burst removes itself when it finishes",
    });

    await mouseClick(await box());
    await browser.pause(600); // longer than a burst would take to start
    const unchecked = await taskState();
    strictEqual(unchecked.checked, false, "a second click unchecks it");
    strictEqual(unchecked.dots, 0, "unchecking plays no burst");
  });

  it("ED-16 ⌘⇧F opens find in the note; ⌘F opens search", async function () {
    await openViaPalette("Welcome");
    await typeInEditor("");
    await pressCmd("f", { shift: true, inFocus: true });
    await $("[data-search-overlay]").waitForExist({ timeout: 5_000 });
    ok(!(await $("[cmdk-input]").isExisting()), "⌘⇧F opened no search");
    await browser.keys("Escape");
    await $("[data-search-overlay]").waitForExist({ timeout: 5_000, reverse: true });
    await typeInEditor("");
    await pressCmd("f", { inFocus: true });
    await $("[cmdk-input]").waitForExist({ timeout: 5_000 });
    ok(!(await $("[data-search-overlay]").isExisting()), "⌘F opened no find bar");
    await browser.keys("Escape");
    await $("[cmdk-input]").waitForExist({ timeout: 5_000, reverse: true });
  });

  it("ED-26 ⌘↓ and ⌘↑ go to the very bottom and top of the page", async function () {
    await openViaPalette("Long essay");
    await typeInEditor("", { atEnd: false });
    // The front note's real scroller (`.cm-scroller` doesn't scroll) and
    // whether its title is on screen. `nudge` scrolls it 1px first: the hidden
    // e2e window runs no frames, so CodeMirror never runs the measure the
    // scroll happens in by itself (qa-checklist harness notes).
    const page = (nudge = 0) =>
      browser.execute((by) => {
        const scope = document.querySelector("[data-column-tab][data-focused]") ?? document;
        const editor = [...scope.querySelectorAll(".cm-editor")].find((el) => el.offsetParent);
        let scroller = editor.parentElement;
        while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
          scroller = scroller.parentElement;
        }
        scroller.scrollTop += by;
        const title = [...scope.querySelectorAll("[data-page-title]")].find(
          (el) => el.offsetParent,
        );
        const box = scroller.getBoundingClientRect();
        return {
          top: scroller.scrollTop,
          fromBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
          titleShown: title.getBoundingClientRect().top >= box.top - 1,
        };
      }, nudge);
    /** Poll, nudging the scroller ±1px between reads, until `done(state)`. */
    const waitForPage = async (done, timeoutMsg) => {
      let step = 1;
      let seen = null;
      await browser
        .waitUntil(
          async () => {
            await page(step);
            step = -step;
            await browser.pause(150);
            seen = await page();
            return done(seen);
          },
          { timeout: 5_000, interval: 100 },
        )
        .catch(() => {
          throw new Error(`${timeoutMsg}: ${JSON.stringify(seen)}`);
        });
    };

    await pressCmd("ArrowDown", { inFocus: true });
    await waitForPage((state) => state.fromBottom < 2, "⌘↓ did not reach the bottom of the page");
    ok((await page()).top > 1000, "the long note scrolled down");
    // The caret went with it: typing lands at the note's end.
    await typeInEditor("End mark", { atEnd: false });
    const path = `${await workspaceRoot()}/Notes/Long essay.md`;
    await browser.waitUntil(
      async () => {
        const read = await invoke("read_file", { path });
        const text = typeof read.value === "string" ? read.value : (read.value?.content ?? "");
        return text.trimEnd().endsWith("End mark");
      },
      { timeout: 5_000, timeoutMsg: "typing after ⌘↓ did not land at the note's end" },
    );

    await pressCmd("ArrowUp", { inFocus: true });
    await waitForPage((state) => state.top < 2, "⌘↑ did not reach the top of the page");
    ok((await page()).titleShown, "the title shows above the body");
  });
});
