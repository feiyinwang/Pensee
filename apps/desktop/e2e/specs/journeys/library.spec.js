// Library (docs/qa/user-journeys.md § Library — LIB): a paper's card opens
// its note with the PDF the note embeds in the reader beside it, as a book's
// card does with its `Book` file, and a paper added from a link to a PDF
// brings that PDF in. The seeded paper and its PDF are `Library/A paper.md`
// (`e2e/qa/seed-vault.mjs`); the linked PDF is served from this process.
import http from "node:http";
import { onePagePdf } from "../../qa/seed-vault.mjs";
import {
  fillField,
  invoke,
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
});
