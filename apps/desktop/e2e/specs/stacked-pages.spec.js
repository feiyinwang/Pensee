import { deepEqual, equal, ok } from "node:assert/strict";

// Stacked pages verification (see SPECs/stacked-pages-spec.md): clicking a
// wiki link opens the page as a column right of the page it came from, each
// column is its own island in a horizontally scrolling strip, a column can be
// dragged to a new position by its header, and closing a column collapses
// back to a single page.
//
// Seeds its own linked pages into the restored workspace and self-skips
// without one, like latex-math.spec.js. Set STACKED_PAGES_SHOTS to a
// directory to save a screenshot after each step.
describe("Stacked pages", function () {
  const PAGES = {
    "stack-e2e-one": "# Stack one\n\nGo to [[stack-e2e-two]] next.\n",
    "stack-e2e-two": "# Stack two\n\nThen [[stack-e2e-three]] after.\n",
    "stack-e2e-three": "# Stack three\n\nThe end of the trail.\n",
  };
  const shots = process.env.STACKED_PAGES_SHOTS;

  let workspaceRestored = false;
  let root = null;

  async function invoke(cmd, args) {
    return browser.executeAsync(
      (c, a, done) => {
        window.__TAURI_INTERNALS__
          .invoke(c, a)
          .then((v) => done({ ok: true, value: v }))
          .catch((e) => done({ ok: false, error: e && e.message ? e.message : String(e) }));
      },
      cmd,
      args,
    );
  }

  async function columnTitles() {
    return browser.execute(() =>
      [...document.querySelectorAll(".stacked-pages[data-active] > .stacked-page")]
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
        .map((el) => el.querySelector(".stacked-page-title")?.textContent ?? ""),
    );
  }

  async function shot(name) {
    if (shots) await browser.saveScreenshot(`${shots}/${name}.png`);
  }

  // The driver's native click does not reach CodeMirror's link handlers on
  // WKWebView, so press the link with synthetic mouse events.
  async function clickWikiLink(text) {
    const link = await $(`.cm-wiki-link*=${text}`);
    await link.waitForExist({ timeout: 10_000 });
    await browser.execute((el) => {
      const r = el.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: r.left + 4,
        clientY: r.top + r.height / 2,
      };
      for (const type of ["mousedown", "mouseup", "click"]) {
        el.dispatchEvent(new MouseEvent(type, init));
      }
    }, link);
  }

  // Drag a column header to a horizontal client position with pointer events.
  async function dragHeader(stem, toX) {
    await browser.execute(
      (selector, x) => {
        const header = document.querySelector(selector);
        const r = header.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const at = (clientX) => ({
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          pointerId: 1,
          isPrimary: true,
          clientX,
          clientY: y,
        });
        let cx = r.left + r.width / 2;
        header.dispatchEvent(new PointerEvent("pointerdown", at(cx)));
        for (let i = 1; i <= 12; i++) {
          cx = cx + (x - cx) / (13 - i);
          window.dispatchEvent(new PointerEvent("pointermove", at(cx)));
        }
        window.dispatchEvent(new PointerEvent("pointerup", { ...at(cx), buttons: 0 }));
      },
      `.stacked-page[data-path$='${stem}.md'] .stacked-page-title`,
      toX,
    );
  }

  before(async function () {
    workspaceRestored = await $('[data-sidebar-surface][data-workspace-open="true"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    if (!workspaceRestored) return;

    // The driven window is hidden (visibilityState "hidden"), so WebKit never
    // advances the animation timeline: transitions would freeze at their start
    // values. Switch them off so assertions and screenshots see end states.
    await browser.execute(() => {
      const style = document.createElement("style");
      style.textContent = "*, *::before, *::after { transition: none !important; }";
      document.head.append(style);
    });

    const recents = await invoke("get_recent_workspaces", {});
    root = recents.ok && Array.isArray(recents.value) ? recents.value[0] : null;
    ok(root, "no workspace root to seed pages into");
    for (const [stem, content] of Object.entries(PAGES)) {
      const wrote = await invoke("write_file", { path: `${root}/${stem}.md`, content });
      ok(wrote.ok, `failed to seed ${stem}: ${wrote.error}`);
    }
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (!root) return;
    for (const stem of Object.keys(PAGES)) {
      await invoke("delete_entry", { path: `${root}/${stem}.md` });
    }
  });

  it("opens the first page as a single, full-width page", async function () {
    await shot("00-start");
    const row = await $("span*=Stack one");
    await row.waitForExist({ timeout: 15_000 });
    await row.click();
    await $(".cm-wiki-link*=stack-e2e-two").waitForExist({ timeout: 10_000 });
    const stacked = await browser.execute(
      () => !!document.querySelector(".stacked-pages[data-active][data-stacked]"),
    );
    equal(stacked, false);
  });

  it("opens a linked page as a second column beside the first", async function () {
    await clickWikiLink("stack-e2e-two");
    await browser.waitUntil(async () => (await columnTitles()).length === 2, {
      timeout: 10_000,
      timeoutMsg: "the linked page never opened as a column",
    });
    deepEqual(await columnTitles(), ["Stack one", "Stack two"]);
    await browser.pause(400);
    await shot("01-two-columns");
  });

  it("keeps adding columns to the right", async function () {
    await clickWikiLink("stack-e2e-three");
    await browser.waitUntil(async () => (await columnTitles()).length === 3, {
      timeout: 10_000,
      timeoutMsg: "the third page never opened",
    });
    deepEqual(await columnTitles(), ["Stack one", "Stack two", "Stack three"]);
    const glass = await browser.execute(
      () => getComputedStyle(document.querySelector(".glass-panel")).backgroundImage,
    );
    equal(glass, "none", "the panel behind the islands should step back");
    await browser.pause(400);
    await shot("02-three-columns");
  });

  it("scrolls the strip horizontally", async function () {
    const scrollable = await browser.execute(() => {
      const strip = document.querySelector(".stacked-pages[data-active]");
      return strip.scrollWidth > strip.clientWidth;
    });
    if (!scrollable) this.skip();
    const left = await browser.execute(() => {
      const strip = document.querySelector(".stacked-pages[data-active]");
      strip.scrollLeft = 0;
      return strip.scrollLeft;
    });
    equal(left, 0);
  });

  it("moves a column by dragging its header", async function () {
    const toX = await browser.execute(() => {
      document.querySelector(".stacked-pages[data-active]").scrollLeft = 0;
      return document
        .querySelector(".stacked-page[data-path$='stack-e2e-one.md']")
        .getBoundingClientRect().left;
    });
    await dragHeader("stack-e2e-three", toX);
    await browser.waitUntil(async () => (await columnTitles())[0] === "Stack three", {
      timeout: 5_000,
      timeoutMsg: `drag did not reorder: ${JSON.stringify(await columnTitles())}`,
    });
    await browser.pause(400);
    await shot("03-after-drag");
  });

  it("closes a column and collapses back to one page", async function () {
    for (const stem of ["stack-e2e-three", "stack-e2e-two"]) {
      const close = await $(`.stacked-page[data-path$='${stem}.md'] .stacked-page-close`);
      await browser.execute((el) => el.click(), close);
    }
    await browser.waitUntil(
      async () =>
        browser.execute(() => !document.querySelector(".stacked-pages[data-active][data-stacked]")),
      { timeout: 5_000, timeoutMsg: "stack never collapsed" },
    );
    await shot("04-single-page");
  });
});
