import { copyFileSync, existsSync } from "node:fs";
import { equal, ok } from "node:assert/strict";

// Text size (SPECs/book-reader-spec.md, "Text size"): Aa in an EPUB opens
// smaller/larger buttons, the passage being read stays in view as the text
// changes size, and the size outlives a reload. Set BOOK_EPUB to an EPUB with
// six or more chapters; without it the spec skips.

const BOOK = process.env.BOOK_EPUB;

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

/** The text at the top of the book's view: the chapter it is in and how far
 *  down it, plus the pages' font size. */
function view() {
  return browser.execute(() => {
    const scroller = document.querySelector(".book-reader-scroller");
    if (!scroller) return null;
    // Below the pages' top padding, so the first chapter counts at the start.
    const top = scroller.getBoundingClientRect().top + 48;
    const section = [...scroller.querySelectorAll(".book-epub-section")].find((el) => {
      const box = el.getBoundingClientRect();
      return box.top <= top && top < box.bottom;
    });
    const pages = scroller.querySelector(".book-reader-pages");
    if (!section || !pages) return null;
    const box = section.getBoundingClientRect();
    return {
      section: section.dataset.section,
      at: (top - box.top) / box.height,
      size: getComputedStyle(pages).fontSize,
    };
  });
}

async function waitForBook() {
  await browser.waitUntil(
    () =>
      browser.execute(
        () =>
          document.querySelectorAll(".book-epub-section").length > 5 &&
          !document.querySelector(".book-reader-status"),
      ),
    { timeout: 20_000, timeoutMsg: "the book never opened" },
  );
  await browser.pause(800);
}

async function press(label) {
  await $(`button[aria-label="${label}"]`).click();
  await browser.pause(400);
}

describe("Book text size", function () {
  let root;

  before(async function () {
    if (!BOOK || !existsSync(BOOK) || !BOOK.toLowerCase().endsWith(".epub")) this.skip();
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
    const recents = await invoke("get_recent_workspaces");
    ok(recents.ok, `recent workspaces failed: ${recents.error}`);
    root = typeof recents.value[0] === "string" ? recents.value[0] : recents.value[0].path;
    copyFileSync(BOOK, `${root}/Size book.epub`);
    await invoke("write_file", {
      path: `${root}/Size book.md`,
      content: `---\nBook: Size book.epub\nType: Book\n---\n# Size book\n`,
    });
    // One tab: the book.
    await invoke("save_session", {
      workspaceRoot: root,
      tabs: [
        {
          location: { kind: "book", path: `${root}/Size book.epub`, note: `${root}/Size book.md` },
          back: [],
          forward: [],
        },
      ],
      activeIndex: 0,
    });
    await browser.execute(() => {
      window.addEventListener("beforeunload", (event) => event.stopImmediatePropagation(), true);
    });
    await browser.refresh();
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
    await waitForBook();
  });

  after(async function () {
    if (!root) return;
    await invoke("delete_entry", { path: `${root}/Size book.epub` });
    await invoke("delete_entry", { path: `${root}/Size book.md` });
  });

  it("changes the size and keeps the passage in view", async function () {
    equal((await view())?.size, "17px", "a book starts at 17px");

    // Partway into the middle of the book, as a reader would.
    await browser.execute(() => {
      const scroller = document.querySelector(".book-reader-scroller");
      scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      const sections = scroller.querySelectorAll(".book-epub-section");
      const section = sections[Math.floor(sections.length / 2)];
      section.scrollIntoView({ block: "start" });
      scroller.scrollTop = section.offsetTop + section.offsetHeight * 0.4;
    });
    await browser.pause(600);
    const before = await view();
    ok(before, "no passage in view");

    await $('button[aria-label="Text size"]').click();
    await browser.pause(300);
    await press("Larger text");
    await press("Larger text");
    const larger = await view();
    equal(larger.size, "21px", "two steps larger");
    equal(larger.section, before.section, "the chapter left the view");
    ok(Math.abs(larger.at - before.at) < 0.02, `moved: ${JSON.stringify({ before, larger })}`);

    for (let i = 0; i < 3; i++) await press("Smaller text");
    const smaller = await view();
    equal(smaller.size, "15px", "three steps smaller");
    equal(smaller.section, before.section, "the chapter left the view");
    ok(Math.abs(smaller.at - before.at) < 0.02, `moved: ${JSON.stringify({ before, smaller })}`);

    // Escape closes the tray.
    await browser.keys("Escape");
    await browser.pause(300);
    ok(!(await $('button[aria-label="Larger text"]').isExisting()), "the tray stayed open");

    // Every book opens at the size last chosen.
    await browser.pause(800);
    await browser.refresh();
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
    await waitForBook();
    equal((await view())?.size, "15px", "the size did not survive a reload");
  });
});
