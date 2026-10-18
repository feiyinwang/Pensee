// Library (docs/qa/user-journeys.md § Library — LIB): a paper's card opens
// its note with the PDF the note embeds in the reader beside it, as a book's
// card does with its `Book` file. The paper and its PDF are seeded
// (`Library/A paper.md`, `e2e/qa/seed-vault.mjs`).
import { ok } from "node:assert/strict";
import { waitForTitle } from "./_helpers.js";

/** The kind of every open column, left to right: "book" for the reader. */
async function columnKinds() {
  return browser.execute(() =>
    [...document.querySelectorAll("[data-column-tab]")].map((column) =>
      column.querySelector(".book-reader") ? "book" : "page",
    ),
  );
}

describe("Library journeys", () => {
  it("LIB-07 a paper's card opens its embedded PDF in the reader beside its note", async function () {
    await $('button[data-space-key="library"]').click();
    const papers = await $('button[data-value="papers"]');
    await papers.waitForExist({ timeout: 10_000 });
    await papers.click();
    const card = await $('//*[@data-cover="paper"]//button[.//*[normalize-space(.)="A paper"]]');
    await card.waitForExist({ timeout: 10_000 });
    await card.click();

    await waitForTitle("A paper", 10_000);
    await browser.waitUntil(async () => (await columnKinds()).includes("book"), {
      timeout: 10_000,
      timeoutMsg: "the paper's PDF never opened in the reader",
    });
    const kinds = await columnKinds();
    const book = kinds.indexOf("book");
    ok(book > 0 && kinds[book - 1] === "page", `reader not right of the note: ${kinds}`);
    await browser.waitUntil(
      () =>
        browser.execute(
          () => document.querySelector(".book-reader canvas, .book-reader-pages > *") !== null,
        ),
      { timeout: 10_000, timeoutMsg: "the reader never drew the PDF's page" },
    );
  });
});
