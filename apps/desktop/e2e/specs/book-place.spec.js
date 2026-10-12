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

/** The scroll offset of the book on screen, or null with none. */
function bookScrollTop() {
  return browser.execute(() => {
    const scroller = [...document.querySelectorAll(".book-reader-scroller")].find(
      (el) => !el.closest(".tab-column[data-hidden]"),
    );
    return scroller ? scroller.scrollTop : null;
  });
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
    const left = await bookScrollTop();
    ok(left > 0, "the book did not scroll");

    // Another tab, then back.
    const ids = await browser.execute(() =>
      [...document.querySelectorAll(".tab-column")].map((el) => ({
        id: el.dataset.columnTab,
        book: !!el.querySelector(".book-reader"),
      })),
    );
    await switchTo(ids.find((tab) => !tab.book).id);
    await switchTo(ids.find((tab) => tab.book).id);
    equal(await bookScrollTop(), left, "switching tabs moved the book");

    // Its Library card again.
    await openFromLibrary();
    await browser.pause(800);
    equal(await bookScrollTop(), left, "the Library card moved the book");

    // A reload restores the book tab, at the same place.
    await browser.refresh();
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
    await waitForBook();
    equal(await bookTabs(), 1, "the book tab was not restored");
    ok(Math.abs((await bookScrollTop()) - left) < 2, "the restored book is not at its place");
  });
});
