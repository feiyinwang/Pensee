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

  it("says X isn't connected, with a way to connect", async function () {
    const bar = await $("button=Connect X");
    ok(await bar.isExisting(), "no Connect X");
    await browser.saveScreenshot(process.env.BOOKMARKS_SHOT ?? "/tmp/library-bookmarks.png");
  });
});

describe("Bookmark videos", function () {
  const videoState = () =>
    browser.execute(() =>
      [...document.querySelectorAll(".cm-video-embed video")].map((v) => ({
        gif: v.parentElement?.hasAttribute("data-gif") ?? false,
        controls: v.controls,
        loop: v.loop,
        muted: v.muted,
        readyState: v.readyState,
        duration: v.duration,
        width: v.getBoundingClientRect().width,
      })),
    );

  it("plays an embedded MP4 with controls", async function () {
    await $('[data-space-key="library"]').click();
    await $('button[data-value="bookmarks"]').click();
    await $("button*=Lena Park").click();
    await browser.waitUntil(async () => (await videoState()).some((v) => v.readyState >= 1), {
      timeout: 10_000,
      timeoutMsg: "the video never loaded its metadata",
    });
    const [video] = await videoState();
    ok(video.controls && !video.gif && !video.loop, JSON.stringify(video));
    ok(Math.abs(video.duration - 3) < 0.2, `duration ${video.duration}`);
    ok(video.width > 200, `width ${video.width}`);
    await browser.saveScreenshot(process.env.THREAD_SHOT ?? "/tmp/bookmark-thread.png");
  });

  it("plays a -gif.mp4 like a GIF: looping, muted, no controls", async function () {
    await $('[data-space-key="library"]').click();
    await $('button[data-value="bookmarks"]').click();
    await $("button*=Kofi Mensah").click();
    await browser.waitUntil(
      async () => (await videoState()).some((v) => v.gif && v.readyState >= 1),
      { timeout: 10_000, timeoutMsg: "the GIF never loaded" },
    );
    const gif = (await videoState()).find((v) => v.gif);
    ok(gif.gif && gif.loop && gif.muted && !gif.controls, JSON.stringify(gif));
  });
});
