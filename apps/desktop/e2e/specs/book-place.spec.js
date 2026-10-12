import { copyFileSync, existsSync } from "node:fs";
import { equal, ok } from "node:assert/strict";

// Reading place (SPECs/book-reader-spec.md, "Reading place"): a book shows the
// passage it was left at when you come back to it — from another tab, from
// its Library card, and after a reload, where the book tab is restored with
// the rest of the session. Set BOOK_EPUB to an EPUB with six or more chapters
// (or a PDF with six or more pages); without it the spec skips.

const BOOK = process.env.BOOK_EPUB;
const EXT = BOOK?.toLowerCase().endsWith(".pdf") ? "pdf" : "epub";
const SECTION = EXT === "pdf" ? ".book-pdf-page" : ".book-epub-section";

async function invoke(command, args) {
  return browser.executeAsync(
    (cmd, cmdArgs, done) => {
      window.__TAURI_INTERNALS__
        .invoke(cmd, cmdArgs)
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    },
    command,
    args ?? {},
  );
}

/** Where the middle of the book on screen is: its section (PDF page or EPUB
 *  chapter) and how far down it, or null with no book. Scroll offsets can't
 *  be compared: chapters above the place may be at their real height on one
 *  visit and a placeholder height on the next. */
function place() {
  return browser.execute(() => {
    const scroller = [...document.querySelectorAll(".book-reader-scroller")].find(
      (el) => !el.closest(".tab-column[data-hidden]"),
    );
    if (!scroller) return null;
    const r = scroller.getBoundingClientRect();
    const middle = r.top + r.height / 2;
    const section = [...scroller.querySelectorAll("[data-section]")].find((el) => {
      const box = el.getBoundingClientRect();
      return box.top <= middle && middle < box.bottom;
    });
    if (!section) return null;
    const box = section.getBoundingClientRect();
    return { section: section.dataset.section, at: (middle - box.top) / box.height };
  });
}

async function assertAt(expected, message) {
  const actual = await place();
  ok(
    actual?.section === expected.section && Math.abs(actual.at - expected.at) < 0.01,
    `${message}: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  );
}

function bookTabs() {
  return browser.execute(
    () =>
      [...document.querySelectorAll(".tab-column")].filter((el) => el.querySelector(".book-reader"))
        .length,
  );
}

async function openFromLibrary() {
  await $('[data-space-key="library"]').click();
  await $('button[data-value="books"]').click();
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const label = [...document.querySelectorAll("[data-cover] *")].find(
          (el) => el.children.length === 0 && el.textContent.trim() === "Place book",
        );
        label?.click();
        return Boolean(label);
      }),
    { timeout: 15_000, timeoutMsg: "no Place book card in the Library" },
  );
}

async function waitForBook() {
  await browser.waitUntil(
    () =>
      browser.execute(
        (sel) =>
          document.querySelectorAll(sel).length > 5 &&
          !document.querySelector(".book-reader-status"),
        SECTION,
      ),
    { timeout: 20_000, timeoutMsg: "the book never opened" },
  );
  // Restoring places the book over a few frames.
  await browser.pause(800);
}

async function switchTo(tabId) {
  await browser.execute((id) => {
    document
      .querySelector(`.tab-column[data-column-tab="${id}"]`)
      ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  }, tabId);
  await browser.pause(500);
}

describe("Book reading place", function () {
  let root;

  before(async function () {
    if (!BOOK || !existsSync(BOOK)) this.skip();
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
    const recents = await invoke("get_recent_workspaces");
    ok(recents.ok, `recent workspaces failed: ${recents.error}`);
    root = typeof recents.value[0] === "string" ? recents.value[0] : recents.value[0].path;
    copyFileSync(BOOK, `${root}/Place book.${EXT}`);
    await invoke("write_file", {
      path: `${root}/Place book.md`,
      content: `---\nBook: Place book.${EXT}\nType: Book\n---\n# Place book\n`,
    });
    // Start from one plain tab, whatever an earlier run left open.
    await invoke("save_session", {
      workspaceRoot: root,
      tabs: [{ location: { kind: "file", path: `${root}/Place book.md` }, back: [], forward: [] }],
      activeIndex: 0,
    });
    await browser.execute(() => {
      window.addEventListener("beforeunload", (event) => event.stopImmediatePropagation(), true);
    });
    await browser.refresh();
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
  });

  after(async function () {
    if (!root) return;
    await invoke("delete_entry", { path: `${root}/Place book.${EXT}` });
    await invoke("delete_entry", { path: `${root}/Place book.md` });
  });

  it("comes back to the passage it was left at", async function () {
    await openFromLibrary();
    await waitForBook();

    // Read into the book: the middle of its sixth section.
    await browser.execute((sel) => {
      const scroller = [...document.querySelectorAll(".book-reader-scroller")].find(
        (el) => !el.closest(".tab-column[data-hidden]"),
      );
      scroller.querySelectorAll(sel)[5].scrollIntoView({ block: "start" });
    }, SECTION);
    await browser.pause(300);
    await browser.execute((sel) => {
      const scroller = [...document.querySelectorAll(".book-reader-scroller")].find(
        (el) => !el.closest(".tab-column[data-hidden]"),
      );
      const section = scroller.querySelectorAll(sel)[5];
      scroller.scrollTop = section.offsetTop + section.offsetHeight / 2;
    }, SECTION);
    // The place saves once scrolling settles.
    await browser.pause(1000);
    const left = await place();
    ok(left && Number(left.section) >= 5, `the book did not scroll: ${JSON.stringify(left)}`);

    // Another tab, then back.
    const ids = await browser.execute(() =>
      [...document.querySelectorAll(".tab-column")].map((el) => ({
        id: el.dataset.columnTab,
        book: !!el.querySelector(".book-reader"),
      })),
    );
    await switchTo(ids.find((tab) => !tab.book).id);
    await switchTo(ids.find((tab) => tab.book).id);
    await assertAt(left, "switching tabs moved the book");

    // Its Library card again.
    await openFromLibrary();
    await browser.pause(800);
    await assertAt(left, "the Library card moved the book");

    // Closed, then opened again from its Library card.
    await browser.execute(() => {
      document
        .querySelector(".book-reader-scroller")
        .closest(".tab-column")
        .querySelector(".tab-column-close")
        .click();
    });
    await browser.pause(500);
    await openFromLibrary();
    await waitForBook();
    await assertAt(left, "the reopened book is not at its place");

    // A reload restores the book tab, at the same place.
    await browser.refresh();
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
    await waitForBook();
    equal(await bookTabs(), 1, "the book tab was not restored");
    await assertAt(left, "the restored book is not at its place");
  });
});
