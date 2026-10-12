import { ok, strictEqual } from "node:assert/strict";

// Library → Bookmarks (SPECs/x-bookmarks-spec.md). Needs a workspace with the
// sample notes from `make_fixture.py`-style seeding in `Bookmarks/`: two with a
// video or GIF poster, one with four photos, two text-only (one a thread).
// X itself isn't reached: the tab shows "Not connected to X".

const rect = (selector, index = 0) =>
  browser.execute(
    (sel, i) => {
      const el = document.querySelectorAll(sel)[i];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom };
    },
    selector,
    index,
  );

describe("Library bookmarks", function () {
  before(async function () {
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
    await $('[data-space-key="library"]').click();
    await $('button[data-value="bookmarks"]').click();
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelectorAll('[data-cover="tweet"] [data-kind="tweet"]').length,
        )) === 5,
      { timeout: 10_000, timeoutMsg: "expected five bookmark cards" },
    );
  });

  it("draws each bookmark as a 4:5 card with the post's text", async function () {
    const cards = await browser.execute(() =>
      [...document.querySelectorAll('[data-kind="tweet"]')].map((card) => {
        const r = card.getBoundingClientRect();
        return {
          ratio: r.width / r.height,
          text: card.querySelector("p")?.textContent ?? "",
          img: Boolean(card.querySelector("img")),
          badge: card.querySelector("span")?.textContent ?? null,
        };
      }),
    );
    for (const card of cards) ok(Math.abs(card.ratio - 0.8) < 0.01, `ratio ${card.ratio}`);
    const byText = (start) => cards.find((c) => c.text.startsWith(start));
    const lena = byText("I wrote every first draft");
    ok(lena?.img, "the video bookmark shows its poster");
    strictEqual(lena.badge, "0:42");
    strictEqual(byText("The moment a sentence")?.badge, "GIF");
    strictEqual(byText("Four desks")?.badge, "4 photos");
    // The first paragraph, line breaks kept, and markdown escapes shown as text.
    ok(byText("Plain text outlives")?.text.includes("\nIf a format needs"), "line breaks kept");
    ok(byText("#writing hot take"), "escaped # shown as #");
  });

  it("captions name the author and the thread length", async function () {
    const captions = await browser.execute(() =>
      [...document.querySelectorAll('[data-cover="tweet"] button')].map((b) => b.textContent),
    );
    ok(
      captions.some((c) => c.includes("Lena Park") && c.includes("@lenawrites · Thread · 7 posts")),
      captions.join("\n"),
    );
    ok(
      captions.some((c) => c.includes("@kofim · Post")),
      captions.join("\n"),
    );
  });

  it("keeps the card's picture inside the card and the badge inside the picture", async function () {
    const card = await rect('[data-kind="tweet"][data-media]');
    const media = await browser.execute(() => {
      const img = document.querySelector('[data-kind="tweet"][data-media] img');
      const badge = img?.nextElementSibling;
      if (!img || !badge) return null;
      // DOMRect's fields are getters, which don't survive the trip back.
      const plain = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, bottom: r.bottom };
      };
      return {
        media: plain(img.parentElement),
        badge: plain(badge),
        nowrap: getComputedStyle(badge).whiteSpace,
      };
    });
    ok(media, "media box not found");
    ok(media.media.bottom <= card.bottom - 9 && media.media.left >= card.left + 9, "media inset");
    ok(media.badge.bottom <= media.media.bottom && media.badge.left >= media.media.left, "badge");
    strictEqual(media.nowrap, "nowrap");
  });

  it("fills only the selected tab", async function () {
    const fill = await browser.execute(() => {
      const pressed = document.querySelector('button[data-value="bookmarks"]');
      const selection = pressed?.querySelector('[aria-hidden="true"]');
      if (!pressed || !selection) return null;
      const a = pressed.getBoundingClientRect();
      const b = selection.getBoundingClientRect();
      return {
        dx: Math.abs(a.left - b.left),
        dw: Math.abs(a.width - b.width),
        hidden: document.hidden,
      };
    });
    ok(fill, "no selection fill in the Bookmarks tab");
    // A hidden window gets no animation frames, so the fill's slide never ends.
    if (fill.hidden) this.skip();
    ok(fill.dx < 2 && fill.dw < 2, `fill is off the selected tab: ${JSON.stringify(fill)}`);
  });

  it("says X isn't connected, with a way to connect", async function () {
    const bar = await $("button=Connect X");
    ok(await bar.isExisting(), "no Connect X");
    await browser.saveScreenshot(process.env.BOOKMARKS_SHOT ?? "/tmp/library-bookmarks.png");
  });
});
