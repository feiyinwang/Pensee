import { ok, strictEqual } from "node:assert/strict";

// The thread view of an X bookmark note (SPECs/x-bookmarks-spec.md,
// "Reading"). Needs the bookmark workspace of `library-bookmarks.spec.js`,
// with Lena Park's note as a seven-post thread: text, a video, a GIF, a quoted
// post, two photos, then a `---` and the user's own notes.

const POSTS = [
  "I wrote every",
  "Step one",
  "Step two",
  "Step three",
  "This is the idea",
  "Before and after",
  "The template",
];

const open = async (author) => {
  await $('[data-space-key="library"]').click();
  await $('button[data-value="bookmarks"]').click();
  await $(`button*=${author}`).click();
  await $(".cm-tweet-header").waitForExist({ timeout: 10_000 });
};

/** One look at the shown editor, every position in document coordinates
 *  (top of the scroller's content), so looks at different scroll positions
 *  can be merged. Only lines near the viewport are rendered. */
const look = (starts) =>
  browser.execute((starts) => {
    const pane = document.querySelector("[data-pane]:not(.invisible)");
    let scroller = pane.querySelector(".cm-editor");
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top - base, bottom: r.bottom - base, left: r.left, right: r.right };
    };
    const textLeft = (el) =>
      el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft);
    const lines = {};
    for (const el of pane.querySelectorAll(".cm-line")) {
      const start = starts.find((s) => el.textContent.startsWith(s));
      if (start) lines[start] = { ...box(el), text: textLeft(el) };
    }
    const hrs = [...pane.querySelectorAll(".cm-horizontal-rule-container")].map((c) => ({
      top: box(c).top,
      hidden: getComputedStyle(c.querySelector("hr")).visibility === "hidden",
    }));
    const first = pane.querySelector(".cm-tweet-quote-first");
    const last = pane.querySelector(".cm-tweet-quote-last");
    const video = pane.querySelector(".cm-video-embed:not([data-gif])");
    return {
      scrollTop: scroller.scrollTop,
      maxScroll: scroller.scrollHeight - scroller.clientHeight,
      height: scroller.clientHeight,
      lines,
      hrs,
      quote:
        first && last
          ? {
              first: box(first),
              last: box(last),
              border: getComputedStyle(first).borderTopWidth,
              radius: getComputedStyle(first).borderTopLeftRadius,
              bottom: getComputedStyle(last).borderBottomWidth,
              bar: getComputedStyle(first, "::before").display,
              // Where each quote line's text starts, from the card's edge.
              textStarts: [...pane.querySelectorAll(".cm-tweet-quote")].flatMap((line) => {
                const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
                for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                  const i = n.textContent.search(/[A-Za-z]/);
                  if (i < 0) continue;
                  const range = document.createRange();
                  range.setStart(n, i);
                  range.setEnd(n, i + 1);
                  return [range.getBoundingClientRect().left - line.getBoundingClientRect().left];
                }
                return [];
              }),
            }
          : null,
      video: video ? box(video) : null,
    };
  }, starts);

const scrollTo = (top) =>
  browser.execute((top) => {
    let el = document.querySelector("[data-pane]:not(.invisible) .cm-editor");
    while (el && !/auto|scroll/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    el.scrollTop = top;
  }, top);

/** Scroll through the note and merge what each look saw. */
async function survey(starts) {
  await scrollTo(0);
  await browser.pause(150);
  const seen = { lines: {}, hrs: new Map(), quote: null, video: null };
  for (;;) {
    const l = await look(starts);
    Object.assign(seen.lines, l.lines);
    for (const hr of l.hrs) seen.hrs.set(Math.round(hr.top / 10) * 10, hr.hidden);
    seen.quote ??= l.quote;
    seen.video ??= l.video;
    if (l.scrollTop >= l.maxScroll) break;
    await scrollTo(l.scrollTop + l.height * 0.6);
    await browser.pause(150);
  }
  await scrollTo(0);
  return seen;
}

/** The header and the spine overlay; the overlay is drawn for the whole
 *  thread, rendered or not. Positions in document coordinates. */
const thread = () =>
  browser.execute(() => {
    const pane = document.querySelector("[data-pane]:not(.invisible)");
    const header = pane.querySelector(".cm-tweet-header");
    let scroller = pane.querySelector(".cm-editor");
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top - base, bottom: r.bottom - base, left: r.left, right: r.right };
    };
    const spine = pane.querySelector(".cm-tweet-spine-line");
    return {
      name: header.querySelector(".cm-tweet-name")?.textContent,
      meta: header.querySelector(".cm-tweet-meta")?.textContent,
      open: header.querySelector(".cm-tweet-open")?.textContent,
      facts: header.querySelector(".cm-tweet-facts")?.textContent ?? null,
      avatar: box(header.querySelector(".cm-tweet-avatar")),
      nameLeft: box(header.querySelector(".cm-tweet-name")).left,
      spine: spine ? box(spine) : null,
      dots: [...pane.querySelectorAll(".cm-tweet-dot")].map(box),
      numbers: [...pane.querySelectorAll(".cm-tweet-number")].map((n) => n.textContent),
      lines: pane.querySelectorAll(".cm-tweet-line").length,
    };
  });

describe("Bookmark thread view", function () {
  let t;
  let seen;

  before(async function () {
    await open("Lena Park");
    // The overlay is measured on the next frame.
    await browser.waitUntil(async () => (await thread()).dots.length === 7, {
      timeout: 10_000,
      timeoutMsg: "the spine never drew seven dots",
    });
    seen = await survey([...POSTS, "My own notes", "---"]);
    // After the survey: a video's real height is only known once rendered,
    // and the overlay follows it.
    await browser.pause(200);
    t = await thread();
  });

  it("opens with the author, the date and Open on X", async function () {
    strictEqual(t.name, "Lena Park");
    ok(t.meta.startsWith("@lenawrites · Oct 8"), t.meta);
    strictEqual(t.open, "Open on X");
    strictEqual(t.facts, "7 posts · Bookmarked Oct 10");
    await scrollTo(t.avatar.top - 40);
    await browser.pause(200);
    await browser.saveScreenshot(process.env.THREAD_SHOT ?? "/tmp/tweet-thread.png");
  });

  it("puts the posts on one spine with a dot each and numbers from 2/7", async function () {
    strictEqual(t.numbers.join(" "), "2/7 3/7 4/7 5/7 6/7 7/7");
    const axis = (t.avatar.left + t.avatar.right) / 2;
    ok(Math.abs((t.spine.left + t.spine.right) / 2 - axis) < 1, `spine off the avatar's axis`);
    t.dots.forEach((dot, i) => {
      const line = seen.lines[POSTS[i]];
      ok(line, `post ${i + 1} line not found`);
      const y = (dot.top + dot.bottom) / 2;
      ok(Math.abs((dot.left + dot.right) / 2 - axis) < 1, `dot ${i + 1} off the spine`);
      ok(y > line.top && y < line.top + 30, `dot ${i + 1} at ${y}, its line at ${line.top}`);
      // Post text lines up under the author's name.
      ok(Math.abs(line.text - t.nameLeft) < 1, `post ${i + 1} text at ${line.text}`);
    });
    ok(t.spine.top <= t.dots[0].top + 4, "spine starts at the first dot");
    ok(t.spine.bottom >= seen.lines[POSTS[6]].top, "spine reaches the last post");
    ok(t.spine.bottom < seen.lines["My own notes"].top, "spine stops before your notes");
    ok(seen.video && seen.video.left >= t.nameLeft - 1, `video at ${seen.video?.left}`);
  });

  it("hides the rules between posts and keeps the one before your notes", async function () {
    const hidden = [...seen.hrs.values()];
    strictEqual(hidden.length, 7);
    strictEqual(hidden.filter(Boolean).length, 6);
    const notes = seen.lines["My own notes"];
    ok(notes.text < t.nameLeft - 40, "your notes are not indented");
    const shown = [...seen.hrs].find(([, h]) => !h)[0];
    ok(shown > seen.lines[POSTS[6]].top && shown < notes.top, "the shown rule is above your notes");
  });

  it("draws a quoted post as a bordered card", async function () {
    const { quote } = seen;
    ok(quote, "no quote card");
    strictEqual(quote.border, "1px");
    strictEqual(quote.bottom, "1px");
    strictEqual(quote.radius, "12px");
    strictEqual(quote.bar, "none");
    ok(Math.abs(quote.first.left - t.nameLeft) < 1, `card at ${quote.first.left}`);
    ok(quote.last.bottom > quote.first.bottom, "card spans its lines");
    // The hidden `> ` hangs into the padding: text starts 14px in.
    ok(quote.textStarts.length >= 2, "quote text not found");
    for (const x of quote.textStarts) ok(Math.abs(x - 15) < 2, `quote text at ${x}`);
  });

  /** The `---` source line, once the rule has unfolded. */
  const sourceLine = async () => (await look(["---"])).lines["---"];

  it("shows a --- as source, in the post column, when it is pressed", async function () {
    await scrollTo(seen.lines[POSTS[1]].top - 200);
    await browser.pause(200);
    // The driver's click sends no mousedown, which is what unfolds the rule.
    await browser.execute(() => {
      const rule = document.querySelectorAll(
        "[data-pane]:not(.invisible) .cm-horizontal-rule-container",
      )[1];
      const r = rule.getBoundingClientRect();
      const at = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      rule.dispatchEvent(new MouseEvent("mousedown", at));
      rule.dispatchEvent(new MouseEvent("mouseup", at));
    });
    await browser.waitUntil(async () => (await sourceLine()) !== undefined, {
      timeout: 5_000,
      timeoutMsg: "--- never came back as source",
    });
    const source = await sourceLine();
    ok(Math.abs(source.text - t.nameLeft) < 1, `--- at ${source.text}`);
    await browser.pause(200);
    const after = await thread();
    strictEqual(after.dots.length, 7);
    ok(after.spine.top <= source.top && after.spine.bottom >= source.bottom, "spine runs past it");
    await browser.saveScreenshot(process.env.THREAD_SOURCE_SHOT ?? "/tmp/tweet-thread-source.png");
  });

  it("shows a --- as source when the caret moves onto it", async function () {
    await browser.execute(() => {
      const view = document.querySelector("[data-pane]:not(.invisible) .cm-content").cmTile.view;
      view.dispatch({ selection: { anchor: 0 } });
    });
    await browser.waitUntil(async () => (await sourceLine()) === undefined, {
      timeout: 5_000,
      timeoutMsg: "--- stayed as source with the caret away",
    });
    await browser.execute(() => {
      const view = document.querySelector("[data-pane]:not(.invisible) .cm-content").cmTile.view;
      const doc = view.state.doc.toString();
      view.dispatch({ selection: { anchor: doc.indexOf("\n---\n") + 2 } });
    });
    await browser.waitUntil(async () => (await sourceLine()) !== undefined, {
      timeout: 5_000,
      timeoutMsg: "--- never came back as source",
    });
    await scrollTo(seen.lines[POSTS[4]].top - 300);
    await browser.pause(200);
    await browser.saveScreenshot(process.env.THREAD_QUOTE_SHOT ?? "/tmp/tweet-thread-quote.png");
  });

  it("gives a single post the header and no spine", async function () {
    // A second note from Library opens in a column beside the first.
    await open("Ada Lindqvist");
    const one = () =>
      browser.execute(() => {
        const pane = [...document.querySelectorAll("[data-pane]")].find(
          (p) => p.querySelector(".cm-tweet-name")?.textContent === "Ada Lindqvist",
        );
        if (!pane) return null;
        return {
          facts: pane.querySelector(".cm-tweet-facts")?.textContent ?? null,
          dots: pane.querySelectorAll(".cm-tweet-dot").length,
          lines: pane.querySelectorAll(".cm-tweet-line").length,
        };
      });
    await browser.waitUntil(async () => (await one()) !== null, { timeout: 5_000 });
    await browser.pause(200);
    const l = await one();
    strictEqual(l.facts, "Bookmarked Oct 10");
    strictEqual(l.dots, 0);
    ok(l.lines > 0, "the post sits under the name");
  });
});
