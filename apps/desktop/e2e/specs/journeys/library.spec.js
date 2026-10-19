// Library (docs/qa/user-journeys.md § Library — LIB): a paper's card opens
// its note with the PDF the note embeds in the reader beside it, as a book's
// card does with its `Book` file, and a paper added from a link to a PDF
// brings that PDF in. The seeded paper and its PDF are `Library/A paper.md`
// (`e2e/qa/seed-vault.mjs`); the linked PDF is served from this process.
import { ok } from "node:assert";
import http from "node:http";
import { onePagePdf } from "../../qa/seed-vault.mjs";
import {
  fillField,
  invoke,
  mouseClick,
  pressCmd,
  waitForFile,
  waitForTitle,
  workspaceRoot,
} from "./_helpers.js";

/** Every open column, left to right on screen (the DOM keeps a reader's
 *  column elsewhere): its text's start (the tab title comes first) and
 *  whether it holds the reader, drawn. */
async function columns() {
  return browser.execute(() =>
    [...document.querySelectorAll("[data-column-tab]")]
      .map((column) => ({
        left: column.getBoundingClientRect().left,
        text: column.textContent.slice(0, 80),
        reader: column.querySelector(".book-reader canvas, .book-reader-pages > *") !== null,
      }))
      .sort((a, b) => a.left - b.left),
  );
}

/** Wait for `pdf` (its file name) to open in the reader, drawn, in the
 *  column right after the note titled `note`. */
async function waitForReaderBeside(pdf, note) {
  let seen = [];
  const shown = () => {
    const book = seen.findIndex((c) => c.reader && c.text.startsWith(pdf));
    return book > 0 && seen[book - 1].text.startsWith(note);
  };
  await browser
    .waitUntil(async () => ((seen = await columns()), shown()), { timeout: 20_000 })
    .catch(() => {
      throw new Error(
        `${pdf} never opened in the reader right of ${note}: ${JSON.stringify(seen)}`,
      );
    });
}

/** Open a note by name through ⌘O, the way PAL-01 does. */
async function openViaPalette(name) {
  await $(".app-splash").waitForExist({ timeout: 10_000, reverse: true });
  await pressCmd("o");
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue(name);
  const item = await $(`//*[@cmdk-item][contains(., "${name}")]`);
  await item.waitForExist({ timeout: 5_000 });
  await item.click();
  await waitForTitle(name, 10_000);
}

/** ⌘N, `text` as the title, then ⌘⇧↵ (`open`) or ⌘↵. */
async function addFromComposer(text, { open }) {
  // ⌘N goes unheard until the launch splash is gone (when run on its own).
  await $(".app-splash").waitForExist({ timeout: 10_000, reverse: true });
  await pressCmd("n");
  // The box is labelled "New note" only beside other UI: find its field.
  const title = 'input.composer-title[aria-label="Title"]';
  await $(title).waitForExist({ timeout: 5_000 });
  await fillField(title, text);
  await browser.execute(
    (sel, shiftKey) => {
      document.querySelector(sel).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    title,
    open,
  );
}

const PAPER_PDF = onePagePdf("Quiet rooms");
let server;
let address;

describe("Library journeys", () => {
  before(async () => {
    server = http.createServer((req, res) => {
      if (/^\/pubs\/[\w-]+\.pdf$/.test(req.url)) {
        res.writeHead(200, { "Content-Type": "application/pdf" }).end(PAPER_PDF);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    address = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  it("LIB-07 a paper's card opens its embedded PDF in the reader beside its note", async function () {
    await $('button[data-space-key="library"]').click();
    const papers = await $('button[data-value="papers"]');
    await papers.waitForExist({ timeout: 10_000 });
    await papers.click();
    const card = await $('//*[@data-cover="paper"]//button[.//*[normalize-space(.)="A paper"]]');
    await card.waitForExist({ timeout: 10_000 });
    await card.click();

    await waitForTitle("A paper", 10_000);
    await waitForReaderBeside("a-paper.pdf", "A paper.md");
  });

  it("LIB-08 ⌘N, a link to a PDF, ⌘⇧↵ makes a paper note with the PDF beside it", async function () {
    const root = await workspaceRoot();
    await addFromComposer(`${address}/pubs/quiet-rooms.pdf`, { open: true });
    const note = `${root}/127.0.0.1 quiet-rooms.md`;
    const pdf = `${root}/127.0.0.1 quiet-rooms-assets/127.0.0.1 quiet-rooms.pdf`;
    await waitForFile(note, 10_000);
    await waitForFile(pdf, 20_000);
    await waitForReaderBeside("127.0.0.1 quiet-rooms.pdf", "127.0.0.1 quiet-rooms.md");
    await browser.waitUntil(
      async () => {
        const read = await invoke("read_file", { path: note });
        return (
          read.ok &&
          read.value.content.includes("Type: Paper") &&
          read.value.content.includes("![[127.0.0.1 quiet-rooms-assets/127.0.0.1 quiet-rooms.pdf]]")
        );
      },
      { timeout: 10_000, timeoutMsg: "the note never got Type: Paper and the PDF's embed" },
    );
  });

  it("LIB-10 ⌘N, a link to a PDF, ⌘↵, then Open on the notice opens the note with its PDF", async function () {
    const root = await workspaceRoot();
    await addFromComposer(`${address}/pubs/still-air.pdf`, { open: false });
    await waitForFile(`${root}/127.0.0.1 still-air-assets/127.0.0.1 still-air.pdf`, 20_000);
    const openButton = await $(
      '//*[@role="status"][contains(., "Added 127.0.0.1 still-air")]//button[normalize-space(.)="Open"]',
    );
    await openButton.waitForExist({ timeout: 10_000 });
    await openButton.click();
    await waitForReaderBeside("127.0.0.1 still-air.pdf", "127.0.0.1 still-air.md");
  });

  it("BK-05 a book highlight's bullet ends in a pin that opens its book beside the note", async function () {
    // The seeded `A book` (indexed at launch, so ⌘O finds it) becomes the book
    // page of a one-page PDF, with one highlight: "Quiet rooms", page 1.
    const root = await workspaceRoot();
    for (const [path, content] of [
      [`${root}/Library/quiet-book.pdf`, onePagePdf("Quiet rooms help reading")],
      [
        `${root}/Library/A book.md`,
        "---\nType: Book\nAuthor: Someone\nBook: quiet-book.pdf\n---\n\n## Highlights\n\n- Quiet rooms. ^bk-p1-0-11\n",
      ],
    ]) {
      const wrote = await invoke("write_file", { path, content });
      ok(wrote.ok, `write_file failed: ${wrote.error}`);
    }
    await openViaPalette("A book");

    // The bullet ends in the pin, never its id. The pin is in the note's own
    // column: opening a book's note can open the book beside it and focus it.
    const pin = await $(
      '//*[@data-column-tab][.//*[normalize-space(.)="A book"]]//*[contains(@class,"cm-book-pin")]',
    );
    await pin.waitForExist({ timeout: 10_000 });
    const line = await browser.execute((el) => el.closest(".cm-line")?.textContent ?? "", pin);
    ok(/Quiet rooms\./.test(line) && !/\^bk-/.test(line), `the bullet reads: ${line}`);

    // Its tooltip names the place in the book.
    const title = await browser.execute((el) => {
      el.dispatchEvent(new MouseEvent("mouseenter"));
      return el.getAttribute("title");
    }, pin);
    ok(title === "Go to page 1", `the pin's tooltip: ${title}`);

    // Pressing it opens the book beside its note. Going to the passage and its
    // flash run on animation frames the hidden e2e window doesn't run: BK-06.
    await mouseClick(pin);
    await waitForReaderBeside("quiet-book.pdf", "A book.md");
  });
});
