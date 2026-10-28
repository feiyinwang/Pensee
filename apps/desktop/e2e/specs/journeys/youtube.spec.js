// YouTube notes (docs/qa/user-journeys.md § YouTube notes — YT): the
// transcript box. A note's `<details>` transcript shows as a teleprompter
// that follows the video, seeks on a click, copies and hands questions to the
// Agent; beside the video in a wide pane, under it in a narrow one. The
// player's position is the app's own estimate after a seek, so these
// journeys don't wait on YouTube (YT-14, the language menu, does).
import { equal, ok } from "node:assert/strict";
import { execSync } from "node:child_process";
import {
  fillField,
  invoke,
  pressCmd,
  pressKey,
  typeInEditor,
  waitForTitle,
  workspaceRoot,
} from "./_helpers.js";

/** Seeded by qa/seed-vault.mjs: four timed paragraphs, two sentences each. */
const NOTE = "Speech talk";

/** Beside the video only in a pane at least this wide (video-player.css). */
const BESIDE_MIN_WIDTH = 900;

/** The box's lines as the user sees them, which one is being said, where the
 *  box shows (beside the video or in the note) and the note's text. Only the
 *  box on screen counts: the other one is mounted but hidden. */
async function boxState() {
  return browser.execute(() => {
    const box = [...document.querySelectorAll(".transcript-box")].find((el) =>
      el.checkVisibility(),
    );
    const lines = box ? [...box.querySelectorAll(".transcript-box-line")] : [];
    return {
      lines: lines.map((line) => line.querySelector("p")?.textContent ?? ""),
      now: lines.findIndex((line) => line.dataset.state === "now"),
      placement: box?.dataset.placement ?? null,
      collapsed: box?.hasAttribute("data-collapsed") ?? false,
      // Hidden: no box in the note, Transcript in the row under the video.
      hidden: [
        ...document.querySelectorAll(".video-band-row button[title='Show transcript']"),
      ].some((el) => el.checkVisibility()),
      shown: [...document.querySelectorAll(".transcript-box")].filter((el) => el.checkVisibility())
        .length,
      editorText: document.querySelector(".cm-content")?.textContent ?? "",
    };
  });
}

/** Waits for the box on screen (beside the video, or in the note) to have
 *  its lines. The one in the band loads after the note's hidden one. */
async function waitForBox() {
  await browser.waitUntil(
    async () => {
      const state = await boxState();
      return state.hidden || (state.shown === 1 && state.lines.length > 0);
    },
    { timeout: 15_000, timeoutMsg: "no transcript box on screen" },
  );
}

/** Pins the note's pane to `width` px (null: back to its own), as a narrower
 *  or wider window would. */
async function setPaneWidth(width) {
  await browser.execute((px) => {
    const pane = document.querySelector("[data-pane]:not(.invisible)");
    pane.style.width = px === null ? "" : `${px}px`;
    pane.style.flex = px === null ? "" : "none";
  }, width);
}

/** `window.shownBand()` in the page: the video band on screen (an earlier
 *  journey can leave the note mounted, hidden, in another tab). */
async function markShownBand() {
  await browser.execute(() => {
    window.shownBand = () =>
      [...document.querySelectorAll(".video-band")].find((band) => band.checkVisibility());
  });
}

/** Drags the on-screen band's `handle` (`.video-band-resize` down `by` px,
 *  `.video-band-divider` right `by` px). The plugin sends no pointer events,
 *  so they are dispatched on the handle, whose own listeners follow the drag
 *  (pointer capture can't take a made-up id). */
async function dragHandle(handle, by) {
  await browser.execute(
    (selector, px) => {
      const el = shownBand().querySelector(selector);
      el.setPointerCapture = () => {};
      const box = el.getBoundingClientRect();
      const across = selector === ".video-band-divider";
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const at = (type, moved) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 7,
            clientX: across ? x + moved : x,
            clientY: across ? y : y + moved,
          }),
        );
      at("pointerdown", 0);
      at("pointermove", px / 2);
      at("pointermove", px);
      at("pointerup", px);
    },
    handle,
    by,
  );
}

/** The on-screen video's and transcript box's boxes, and the band's width. */
async function bandSizes() {
  return browser.execute(() => {
    const band = shownBand();
    return {
      frame: band.querySelector(".video-frame").getBoundingClientRect().toJSON(),
      box: band.querySelector(".transcript-box")?.getBoundingClientRect().toJSON() ?? null,
      main: band.querySelector(".video-band-main").getBoundingClientRect().toJSON(),
    };
  });
}

/** The button named `label` in the box on screen (beside the video its
 *  buttons are icons, named by aria-label). */
async function shownButton(label) {
  const buttons = await $$(
    `//section[contains(@class,'transcript-box')]//button[@aria-label='${label}' or normalize-space(.)='${label}']`,
  );
  for (const button of buttons) if (await button.isDisplayed()) return button;
  throw new Error(`no ${label} button on screen in the transcript box`);
}

/** Forgets where every video was left (the e2e app keeps its storage
 *  between runs): each note opens at its link's own start. */
async function forgetVideoPositions() {
  await browser.execute(() => localStorage.removeItem("writer.video-positions"));
}

/** Transcript in the row under the video on screen, which brings a hidden
 *  transcript back. */
async function showTranscriptButton() {
  for (const button of await $$("//button[@title='Show transcript']")) {
    if (await button.isDisplayed()) return button;
  }
  throw new Error("no Transcript in the row under the video");
}

/** Open a note from ⌘O. */
async function openNote(name) {
  await pressCmd("o");
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue(name);
  const item = await $(`//*[@cmdk-item][contains(., "${name}")]`);
  await item.waitForExist({ timeout: 10_000 });
  await item.click();
  await waitForTitle(name);
}

describe("YouTube notes: typing in a video note", function () {
  before(async function () {
    const root = await workspaceRoot();
    this.path = `${root}/${NOTE}.md`;
    await forgetVideoPositions();
    // Opened afresh from another note, the way a user comes to it. First in
    // the file: YT-08 leaves the Agent open, holding focus.
    await openNote("Welcome");
    await openNote(NOTE);
    await waitForBox();
  });

  it("YT-10 ★ typing right after opening never breaks the transcript", async function () {
    await browser.waitUntil(
      () =>
        browser.execute(() => document.activeElement?.classList.contains("cm-content") === true),
      { timeout: 3_000, timeoutMsg: "opening the note didn't put the caret in it" },
    );
    // Where the note put the caret: the editor already has focus.
    await typeInEditor("Hello", { atEnd: false });
    const path = this.path;
    let body = "";
    await browser.waitUntil(
      async () => {
        const note = await invoke("read_file", { path });
        body = note.ok ? note.value.content : "";
        return body.includes("Hello");
      },
      { timeout: 5_000, timeoutMsg: `the typed word wasn't saved:\n${body}` },
    );
    const lines = body.split("\n");
    const open = lines.indexOf("<details>");
    const close = lines.indexOf("</details>");
    ok(open >= 0 && close > open, `the <details> lines broke:\n${body}`);
    const typed = lines.findIndex((line) => line.includes("Hello"));
    equal(lines[typed], "Hello", `the word joined another line:\n${body}`);
    ok(typed < open - 1 || typed > close + 1, `the word sits against the transcript:\n${body}`);
    const shown = await browser.execute(() =>
      [...document.querySelectorAll(".cm-line")].some((line) => line.textContent === "Hello"),
    );
    ok(shown, "the typed word doesn't show as a line of the note");
    const state = await boxState();
    ok(state.lines.length >= 8, `the transcript box went away: ${JSON.stringify(state)}`);
    ok(!state.editorText.includes("<summary>"), "the raw <summary> shows in the note");
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-10-typed.png`);
  });
});

describe("YouTube notes: transcript box", function () {
  before(async function () {
    await workspaceRoot();
    await openNote(NOTE);
    await waitForBox();
  });

  it("YT-04 ★ a note with a transcript shows the box, never the HTML", async function () {
    const state = await boxState();
    ok(state.lines.length >= 8, `expected a line per sentence, got ${state.lines.length}`);
    equal(state.lines[0], "Welcome to the show about speech.");
    equal(state.now, 0, "before the video plays, the first line is the one being said");
    ok(!state.editorText.includes("<summary>"), "the raw <summary> shows in the note");
    ok(!state.editorText.includes("<p><small>"), "the raw <p><small> shows in the note");
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-04-box.png`);
  });

  it("YT-05 clicking a line plays from it and keeps the box", async function () {
    const target = await browser.execute(() =>
      [...document.querySelectorAll(".transcript-box")]
        .find((el) => el.checkVisibility())
        .querySelectorAll(".transcript-box-line")[2]
        .getBoundingClientRect()
        .toJSON(),
    );
    await browser.execute(
      (x, y) => document.elementFromPoint(x, y)?.closest(".transcript-box-line")?.click(),
      target.x + target.width / 2,
      target.y + target.height / 2,
    );
    await browser.waitUntil(async () => (await boxState()).now === 2, {
      timeout: 3_000,
      timeoutMsg: "the clicked line didn't become the one being said",
    });
    const time = await browser.execute(
      () =>
        [
          ...document.querySelectorAll(
            ".transcript-box-line[data-state='now'] .transcript-box-time",
          ),
        ].find((el) => el.checkVisibility())?.textContent,
    );
    equal(time, "1:00");
    const state = await boxState();
    ok(!state.editorText.includes("<summary>"), "a click inside opened the source");
  });

  it("YT-06 scrolling the box stops it following until Back to now", async function () {
    // A scroll with no wheel event first (a trackpad's momentum, a dragged
    // scrollbar, keys): the list's own scroll stops it following. WebKit
    // drops a scrollTop set while the box's own smooth scroll runs, so wait
    // for it to come to rest first.
    let last = -1;
    await browser.waitUntil(
      async () => {
        const top = await browser.execute(
          () =>
            [...document.querySelectorAll(".transcript-box-lines")].find((el) =>
              el.checkVisibility(),
            ).scrollTop,
        );
        const still = top === last;
        last = top;
        return still;
      },
      { timeout: 5_000, interval: 300, timeoutMsg: "the box never came to rest" },
    );
    await browser.execute(() => {
      const list = [...document.querySelectorAll(".transcript-box-lines")].find((el) =>
        el.checkVisibility(),
      );
      list.scrollTop += 120;
    });
    const shown = await $("//button[normalize-space(.)='Back to now']");
    await shown.waitForDisplayed({ timeout: 3_000 });
    await shown.click();
    await shown.waitForDisplayed({ timeout: 3_000, reverse: true });
    await browser.execute(() => {
      const list = [...document.querySelectorAll(".transcript-box-lines")].find((el) =>
        el.checkVisibility(),
      );
      list.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true }));
      list.scrollTop += 120;
    });
    const back = await $("//button[normalize-space(.)='Back to now']");
    await back.waitForDisplayed({ timeout: 3_000 });
    await back.click();
    await back.waitForDisplayed({ timeout: 3_000, reverse: true });
  });

  it("YT-07 Copy puts the whole transcript, with times, on the clipboard", async function () {
    const copy = await shownButton("Copy");
    await copy.click();
    await browser.waitUntil(async () => (await copy.getAttribute("data-copy-state")) === "copied", {
      timeout: 3_000,
      timeoutMsg: "Copy didn't confirm",
    });
    // WebKit won't let a script read the clipboard back: ask macOS.
    const text = execSync("pbpaste", { encoding: "utf8" });
    ok(text.startsWith("0:00 Welcome to the show about speech."), text);
    ok(text.includes("\n\n1:00 Speech is a motor act"), text);
  });

  it("YT-08 Ask opens the Agent with its input focused", async function () {
    const ask = await shownButton("Ask");
    await ask.click();
    await $('[aria-label="Agent"]').waitForExist({ timeout: 5_000 });
    await browser.waitUntil(
      () => browser.execute(() => document.activeElement?.getAttribute("aria-label") === "Message"),
      { timeout: 3_000, timeoutMsg: "the Agent's input didn't take focus" },
    );
  });
});

describe("YouTube notes: where the transcript shows", function () {
  before(async function () {
    const root = await workspaceRoot();
    this.path = `${root}/${NOTE}.md`;
    await openNote(NOTE);
    await waitForBox();
  });

  afterEach(async function () {
    await setPaneWidth(null);
  });

  it("YT-11 the line being said is highlighted, its words shown at once", async function () {
    const line = await browser.execute(() => {
      const box = [...document.querySelectorAll(".transcript-box")].find((el) =>
        el.checkVisibility(),
      );
      const now = box.querySelector(".transcript-box-line[data-state='now']");
      const other = box.querySelector(".transcript-box-line:not([data-state='now'])");
      return {
        nowBackground: getComputedStyle(now).backgroundColor,
        otherBackground: getComputedStyle(other).backgroundColor,
        // A reveal splits the words into animated spans; a highlight leaves
        // the line as one paragraph of text.
        spans: now.querySelectorAll("p span").length,
        opacity: getComputedStyle(now.querySelector("p")).opacity,
      };
    });
    equal(line.spans, 0, "the line is split into revealed words");
    equal(line.opacity, "1");
    ok(
      line.nowBackground !== line.otherBackground,
      `the line being said isn't highlighted (${line.nowBackground})`,
    );
  });

  it("YT-19 the row under the video: the keys in full, then Transcript; no Play or Pin buttons", async function () {
    const row = await browser.execute(() => {
      const el = [...document.querySelectorAll(".video-band .video-band-row")].find((r) =>
        r.checkVisibility(),
      );
      const line = el?.querySelector(":scope > .player-keys");
      const buttons = [...(el?.querySelectorAll(":scope > button") ?? [])];
      return {
        keys: [...(line?.querySelectorAll(".player-key") ?? [])].map((k) => k.textContent.trim()),
        first: el?.firstElementChild === line,
        buttons: buttons.map((b) => b.textContent.trim()),
        sameLine:
          !!line &&
          buttons.every(
            (b) =>
              Math.abs(
                b.getBoundingClientRect().top +
                  b.getBoundingClientRect().height / 2 -
                  (line.getBoundingClientRect().top + line.getBoundingClientRect().height / 2),
              ) < 3,
          ),
      };
    });
    // ⌘S plays on while paused, and pins (and pauses) while playing.
    ok(["Play⌘S", "Pin⌘S"].includes(row.keys[0]), `⌘S isn't named for what it does (${row.keys})`);
    equal(
      row.keys.slice(1).join(" · "),
      "Screenshot⌘⇧S · Slower⇧, · Faster⇧.",
      "the screenshot and speed keys in full",
    );
    ok(row.first, "the keys aren't at the start of the row");
    ok(row.sameLine, "the keys and Transcript aren't on one line");
    ok(
      row.buttons.every((b) => /^(Transcript|Getting transcript…)$/.test(b)),
      `a button other than Transcript in the row (${row.buttons})`,
    );
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-19-keys.png`);
  });

  it("YT-13 ★ beside the video in a wide pane, pinned with it; under it in a narrow one", async function () {
    await setPaneWidth(BESIDE_MIN_WIDTH + 200);
    await browser.waitUntil(async () => (await boxState()).placement === "beside", {
      timeout: 3_000,
      timeoutMsg: "the box isn't beside the video in a wide pane",
    });
    let state = await boxState();
    equal(state.shown, 1, "both boxes show at once");
    const beside = await browser.execute(() => {
      const frame = document.querySelector(".video-frame").getBoundingClientRect();
      const box = document.querySelector(".video-band .transcript-box").getBoundingClientRect();
      return { frame: frame.toJSON(), box: box.toJSON() };
    });
    ok(beside.box.left >= beside.frame.right, "the box isn't to the right of the video");
    ok(Math.abs(beside.box.height - beside.frame.height) < 2, "the box isn't the video's height");
    // Scrolling the note keeps both at the top.
    await browser.execute(() => {
      const scroller = document.querySelector(".video-band").parentElement;
      scroller.scrollTop = scroller.scrollHeight;
    });
    await browser.pause(300);
    const pinned = await browser.execute(() => {
      const frame = document.querySelector(".video-frame").getBoundingClientRect();
      const box = document.querySelector(".video-band .transcript-box").getBoundingClientRect();
      const scrollerEl = document.querySelector(".video-band").parentElement;
      const scroller = scrollerEl.getBoundingClientRect();
      return {
        frameTop: frame.top,
        boxTop: box.top,
        boxRight: box.right,
        scrollerTop: scroller.top,
        // The scroller clips at its padding box: its left edge plus its
        // client width (the scrollbar is outside it).
        clipRight: scroller.left + scrollerEl.clientLeft + scrollerEl.clientWidth,
      };
    });
    equal(
      Math.round(pinned.boxTop),
      Math.round(pinned.frameTop),
      "the box didn't stay by the video",
    );
    ok(pinned.boxTop >= pinned.scrollerTop - 1, "the box scrolled away");
    // Its 1px ring is outside it: whole only with a pixel between the box
    // and the scroller's edges.
    ok(
      pinned.boxTop >= pinned.scrollerTop + 1 && pinned.boxRight <= pinned.clipRight - 1,
      `the box's outline is cut by the note's edge: ${JSON.stringify(pinned)}`,
    );
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-13-beside.png`);

    await setPaneWidth(BESIDE_MIN_WIDTH - 200);
    await browser.waitUntil(async () => (await boxState()).placement === "note", {
      timeout: 3_000,
      timeoutMsg: "the box isn't under the video in a narrow pane",
    });
    state = await boxState();
    equal(state.shown, 1, "both boxes show at once");
    ok(state.lines.length >= 8, "the box under the video lost its lines");
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-13-under.png`);
  });

  it("YT-28 dragging the edge under the video sets its and the transcript's height", async function () {
    // The band on screen: an earlier journey can leave the note mounted,
    // hidden, in another tab.
    await browser.execute(() => {
      window.shownBand = () =>
        [...document.querySelectorAll(".video-band")].find((band) => band.checkVisibility());
    });
    await setPaneWidth(BESIDE_MIN_WIDTH + 300);
    await browser.waitUntil(async () => (await boxState()).placement === "beside", {
      timeout: 3_000,
      timeoutMsg: "the box isn't beside the video in a wide pane",
    });
    const sizes = () =>
      browser.execute(() => {
        const frame = shownBand().querySelector(".video-frame").getBoundingClientRect();
        const box = shownBand().querySelector(".transcript-box").getBoundingClientRect();
        return { frame: frame.toJSON(), box: box.toJSON() };
      });
    // From the default height: the e2e app keeps its storage between runs,
    // so a height dragged in an earlier run is still set.
    await browser.execute(() =>
      shownBand()
        .querySelector(".video-band-resize")
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    await browser.waitUntil(
      async () => browser.execute(() => !shownBand().hasAttribute("data-sized")),
      { timeout: 3_000, timeoutMsg: "a double-click didn't put the default height back" },
    );
    const before = await sizes();
    // The plugin sends no pointer events: dispatch the drag on the edge,
    // whose own listeners follow it (pointer capture can't take a made-up id).
    await browser.execute((by) => {
      const edge = shownBand().querySelector(".video-band-resize");
      edge.setPointerCapture = () => {};
      const y = edge.getBoundingClientRect().top + 4;
      const at = (type, clientY) =>
        edge.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 7,
            clientY,
          }),
        );
      at("pointerdown", y);
      at("pointermove", y - by / 2);
      at("pointermove", y - by);
      at("pointerup", y - by);
    }, 120);
    const after = await sizes();
    ok(
      Math.abs(after.frame.height - (before.frame.height - 120)) < 3,
      `the video isn't 120px shorter (${before.frame.height} → ${after.frame.height})`,
    );
    ok(
      Math.abs(after.box.height - after.frame.height) < 2,
      "the transcript isn't the video's height",
    );
    ok(
      Math.abs(after.frame.width / after.frame.height - 16 / 9) < 0.02,
      "the video isn't 16:9 at its new height",
    );
    ok(
      after.box.width > before.box.width + 100,
      "the transcript didn't take the width the video gave up",
    );
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-28-shorter.png`);

    // A double-click puts it back.
    await browser.execute(() =>
      shownBand()
        .querySelector(".video-band-resize")
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    await browser.waitUntil(
      async () => Math.abs((await sizes()).frame.height - before.frame.height) < 2,
      { timeout: 3_000, timeoutMsg: "a double-click didn't put the height back" },
    );
  });

  it("YT-30 dragging the divider sets the video's width; the transcript takes the rest", async function () {
    await markShownBand();
    await setPaneWidth(BESIDE_MIN_WIDTH + 300);
    await browser.waitUntil(async () => (await boxState()).placement === "beside", {
      timeout: 3_000,
      timeoutMsg: "the box isn't beside the video in a wide pane",
    });
    // From the default size (the e2e app keeps its storage between runs).
    await browser.execute(() =>
      shownBand()
        .querySelector(".video-band-divider")
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    await dragHandle(".video-band-divider", -160);
    const before = await bandSizes();
    await dragHandle(".video-band-divider", 120);
    const after = await bandSizes();
    ok(
      Math.abs(after.frame.width - (before.frame.width + 120)) < 3,
      `the video isn't 120px wider (${before.frame.width} → ${after.frame.width})`,
    );
    ok(
      Math.abs(after.frame.width / after.frame.height - 16 / 9) < 0.02,
      "the video isn't 16:9 at its new width",
    );
    ok(
      Math.abs(after.box.height - after.frame.height) < 2,
      "the transcript isn't the video's height",
    );
    ok(
      Math.abs(after.box.right - after.main.right) < 2 && after.box.left > after.frame.right,
      "the transcript doesn't fill the rest of the width",
    );
  });

  it("YT-29 hiding the transcript gives the video the pane's width; showing it puts back its size", async function () {
    await markShownBand();
    await setPaneWidth(BESIDE_MIN_WIDTH + 300);
    await browser.waitUntil(async () => (await boxState()).placement === "beside", {
      timeout: 3_000,
      timeoutMsg: "the box isn't beside the video in a wide pane",
    });
    await dragHandle(".video-band-resize", -100);
    const sized = await bandSizes();
    await (
      await $("//section[@data-placement='beside']//button[@title='Hide transcript']")
    ).click();
    await browser.waitUntil(async () => (await boxState()).hidden, {
      timeout: 3_000,
      timeoutMsg: "Hide transcript left the box beside the video",
    });
    // From the default size alone (the e2e app keeps its storage between
    // runs, and YT-33 sizes it).
    await browser.execute(() => {
      const band = shownBand();
      if (band.hasAttribute("data-sized-alone")) {
        band
          .querySelector(".video-band-resize")
          .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      }
    });
    await browser.waitUntil(
      async () => browser.execute(() => !shownBand().hasAttribute("data-sized-alone")),
      { timeout: 3_000, timeoutMsg: "a double-click didn't put back the full width" },
    );
    const hidden = await bandSizes();
    ok(
      Math.abs(hidden.frame.width - hidden.main.width) < 2,
      `the video doesn't take the pane's width (${hidden.frame.width} of ${hidden.main.width})`,
    );
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-29-hidden.png`);
    await (await showTranscriptButton()).click();
    await browser.waitUntil(async () => (await boxState()).placement === "beside", {
      timeout: 3_000,
      timeoutMsg: "showing the transcript didn't put it beside the video",
    });
    const shown = await bandSizes();
    ok(
      Math.abs(shown.frame.height - sized.frame.height) < 2,
      "the video lost the size it had beside the transcript",
    );
  });

  it("YT-33 with the transcript hidden, the edge makes the video smaller, apart from its size beside", async function () {
    await markShownBand();
    await setPaneWidth(BESIDE_MIN_WIDTH + 300);
    await browser.waitUntil(async () => (await boxState()).placement === "beside", {
      timeout: 3_000,
      timeoutMsg: "the box isn't beside the video in a wide pane",
    });
    const beside = await bandSizes();
    await (
      await $("//section[@data-placement='beside']//button[@aria-label='Hide transcript']")
    ).click();
    await browser.waitUntil(async () => (await boxState()).hidden, {
      timeout: 3_000,
      timeoutMsg: "the × left the box beside the video",
    });
    const alone = await bandSizes();
    await dragHandle(".video-band-resize", -120);
    const smaller = await bandSizes();
    ok(
      Math.abs(smaller.frame.height - (alone.frame.height - 120)) < 3,
      `the video alone isn't 120px shorter (${alone.frame.height} → ${smaller.frame.height})`,
    );
    ok(
      Math.abs(smaller.frame.width / smaller.frame.height - 16 / 9) < 0.02,
      "the video alone isn't 16:9 at its new height",
    );
    ok(
      Math.abs(
        smaller.frame.left - smaller.main.left - (smaller.main.right - smaller.frame.right),
      ) < 2,
      "the smaller video isn't centred",
    );
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-33-alone.png`);

    // Beside the transcript again: the size it had there, not this one.
    await (await showTranscriptButton()).click();
    await browser.waitUntil(async () => (await boxState()).placement === "beside", {
      timeout: 3_000,
      timeoutMsg: "showing the transcript didn't put it beside the video",
    });
    ok(
      Math.abs((await bandSizes()).frame.height - beside.frame.height) < 2,
      "sizing the video alone changed its size beside the transcript",
    );

    // Hidden again, a double-click on the edge puts back the full width.
    await (
      await $("//section[@data-placement='beside']//button[@aria-label='Hide transcript']")
    ).click();
    await browser.waitUntil(async () => (await boxState()).hidden, {
      timeout: 3_000,
      timeoutMsg: "the × left the box beside the video",
    });
    await browser.execute(() =>
      shownBand()
        .querySelector(".video-band-resize")
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    await browser.waitUntil(
      async () => {
        const now = await bandSizes();
        return Math.abs(now.frame.width - now.main.width) < 2;
      },
      { timeout: 3_000, timeoutMsg: "a double-click didn't put back the full width" },
    );
    await (await showTranscriptButton()).click();
  });

  it("YT-12 hiding the transcript leaves Transcript in the row under the video, and it stays hidden", async function () {
    await setPaneWidth(BESIDE_MIN_WIDTH + 200);
    await browser.waitUntil(async () => (await boxState()).placement === "beside", {
      timeout: 3_000,
    });
    // Beside the video it is a panel, closed by its ×.
    await (await shownButton("Hide transcript")).click();
    await browser.waitUntil(async () => (await boxState()).hidden, {
      timeout: 3_000,
      timeoutMsg: "the × didn't hide the transcript",
    });
    let state = await boxState();
    equal(state.shown, 0, "the hidden transcript still shows in the note");
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-12-hidden.png`);
    // Another visit finds it hidden.
    await openNote("Welcome");
    await openNote(NOTE);
    await waitForBox();
    ok((await boxState()).hidden, "the transcript came back on its own");
    await (await showTranscriptButton()).click();
    await browser.waitUntil(async () => (await boxState()).placement === "beside", {
      timeout: 3_000,
      timeoutMsg: "Transcript in a wide pane didn't put the box back beside the video",
    });

    // Under the video in a narrow pane, its fold hides it the same way.
    await setPaneWidth(BESIDE_MIN_WIDTH - 200);
    await browser.waitUntil(async () => (await boxState()).placement === "note", {
      timeout: 3_000,
      timeoutMsg: "the box isn't under the video in a narrow pane",
    });
    await (await shownButton("Transcript")).click();
    await browser.waitUntil(async () => (await boxState()).hidden, {
      timeout: 3_000,
      timeoutMsg: "the fold didn't hide the transcript",
    });
    state = await boxState();
    equal(state.shown, 0, "the folded transcript still shows in the note");
    await (await showTranscriptButton()).click();
    await browser.waitUntil(
      async () => {
        const now = await boxState();
        return now.placement === "note" && now.lines.length > 0;
      },
      { timeout: 3_000, timeoutMsg: "Transcript didn't bring the box back under the video" },
    );
    await setPaneWidth(BESIDE_MIN_WIDTH + 200);
  });

  it("YT-14 the language menu reads the transcript again in another language", async function () {
    // A video with captions in many languages (needs YouTube).
    await openNote("How we remember");
    await waitForBox();
    const root = await workspaceRoot();
    const path = `${root}/Library/How we remember.md`;
    const menu = await $(
      "//section[contains(@class,'transcript-box')]//button[@aria-haspopup='menu']",
    );
    await browser.waitUntil(
      async () => {
        const menus = await $$(
          "//section[contains(@class,'transcript-box')]//button[@aria-haspopup='menu']",
        );
        for (const m of menus) if (await m.isDisplayed()) return true;
        return false;
      },
      { timeout: 20_000, timeoutMsg: "no language menu for a video with many caption languages" },
    );
    const menus = await $$(
      "//section[contains(@class,'transcript-box')]//button[@aria-haspopup='menu']",
    );
    let shown = menu;
    for (const m of menus) if (await m.isDisplayed()) shown = m;
    // Written before the language was kept: the menu says so. (Arc's button
    // holds a hidden copy of its label for measuring.)
    ok((await shown.getText()).startsWith("Language"), await shown.getText());
    // Radix opens its menu on pointerdown, which the WebDriver plugin's
    // click does not send, so the press is dispatched the way a mouse sends it.
    await browser.execute((trigger) => {
      const init = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" };
      trigger.dispatchEvent(new PointerEvent("pointerdown", init));
    }, shown);
    await browser.waitUntil(async () => (await $$('[role="menuitem"]')).length > 1, {
      timeout: 3_000,
      timeoutMsg: "the menu lists one language",
    });
    const items = await $$('[role="menuitem"]');
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-14-menu.png`);
    const first = (await items[0].getText()).trim();
    ok(first.startsWith("English"), `English isn't first: ${first}`);
    await items[0].click();
    let body = "";
    await browser.waitUntil(
      async () => {
        const note = await invoke("read_file", { path });
        body = note.ok ? note.value.content : "";
        return /<details lang="en[^"]*">/.test(body);
      },
      { timeout: 20_000, timeoutMsg: `the transcript wasn't read again in English:\n${body}` },
    );
    ok(body.includes("- recall beats rereading after a week"), "the note's own lines went away");
    equal(body.match(/<summary>Transcript<\/summary>/g)?.length, 1, "two transcripts in the note");
    await browser.waitUntil(
      async () => {
        for (const m of await $$(
          "//section[contains(@class,'transcript-box')]//button[@aria-haspopup='menu']",
        ))
          if ((await m.isDisplayed()) && (await m.getText()).trim().startsWith("English"))
            return true;
        return false;
      },
      { timeout: 5_000, timeoutMsg: "the menu doesn't say English" },
    );
  });
});

describe("YouTube notes: the arrow and speed keys over the video", function () {
  before(async function () {
    // The workspace first: ⌘O does nothing until it has loaded.
    await workspaceRoot();
    // Listening before the note opens: a paused page reports only on a
    // change, so a note an earlier journey left open would say nothing.
    await browser.execute(() => {
      window.__ytReports = [];
      window.__ytRates = [];
      addEventListener("message", (e) => {
        if (e.data?.source === "pensee-yt" && e.data.type === "state")
          window.__ytReports.push(e.data);
        if (e.data?.source === "pensee-yt" && e.data.type === "prefs")
          window.__ytRates.push(e.data.rate);
      });
    });
    await openNote("Welcome");
    await openNote(NOTE);
    await $(".video-band iframe").waitForExist({ timeout: 15_000 });
    await browser.waitUntil(async () => browser.execute(() => window.__ytReports.length > 0), {
      timeout: 30_000,
      timeoutMsg: "the player page never reported (needs YouTube)",
    });
  });

  /** The pointer over the video, or off it, as the player page reports it:
   *  the frame is another origin, so its own pointer events are out of reach. */
  async function hover(over) {
    await browser.execute((isOver) => {
      const frame = document.querySelector(".video-band iframe");
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "pensee-yt", type: "hover", over: isOver },
          origin: new URL(frame.src).origin,
          source: frame.contentWindow,
        }),
      );
    }, over);
  }

  /** The caret in the note, put `fromEnd` characters before its end. */
  async function caret(fromEnd) {
    return browser.execute((back) => {
      const view = document
        .querySelector(".video-band")
        .closest("[data-pane]")
        .querySelector(".cm-content").cmTile.root.view;
      if (back !== null) {
        view.dispatch({ selection: { anchor: view.state.doc.length - back } });
        view.focus();
      }
      return view.state.selection.main.head;
    }, fromEnd);
  }

  /** Waits for a report the player page sent after `since` with its time
   *  in [min, max]; returns the last such one. Not the last of all: a video
   *  that hadn't started reports 0 while it buffers after the skip. */
  async function reportAfter(since, [min, max], timeout, timeoutMsg) {
    await browser.waitUntil(
      async () =>
        browser.execute(
          (from, lo, hi) => window.__ytReports.slice(from).some((r) => r.t >= lo && r.t <= hi),
          since,
          min,
          max,
        ),
      { timeout, timeoutMsg },
    );
    return browser.execute(
      (from, lo, hi) =>
        window.__ytReports
          .slice(from)
          .filter((r) => r.t >= lo && r.t <= hi)
          .at(-1),
      since,
      min,
      max,
    );
  }

  it("YT-20 ← / → over the video skip it 5s; off it they move the caret", async function () {
    // Measured from where the video is (an earlier journey may have played
    // it): playing on can't add 3s within the 2.5s a skip is given, and
    // never goes back.
    const last = () => browser.execute(() => window.__ytReports.at(-1));
    const at = await caret(2);
    await hover(true);
    const before = await last();
    let since = await browser.execute(() => window.__ytReports.length);
    await pressKey("ArrowRight", { inFocus: true });
    const ahead = await reportAfter(
      since,
      [before.t + 3, before.t + 9],
      before.playing ? 2_500 : 20_000,
      "→ over the video didn't skip it 5s on",
    );
    equal(await caret(null), at, "→ over the video moved the caret");

    since = await browser.execute(() => window.__ytReports.length);
    await pressKey("ArrowLeft", { inFocus: true });
    await reportAfter(since, [0, ahead.t - 3], 20_000, "← over the video didn't skip it back");
    equal(await caret(null), at, "← over the video moved the caret");

    await hover(false);
    await pressKey("ArrowRight", { inFocus: true });
    equal(await caret(null), at + 1, "→ off the video didn't move the caret");
  });

  it("YT-25 ⇧, / ⇧. over the video change its speed; off it they type", async function () {
    /** ⇧ and `code` pressed in the note; whether the app took the key. */
    const press = (key, code) =>
      browser.execute(
        (key, code) => {
          const event = new KeyboardEvent("keydown", {
            key,
            code,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          });
          document.activeElement.dispatchEvent(event);
          return event.defaultPrevented;
        },
        key,
        code,
      );
    await caret(0);
    await hover(false);
    const rates = await browser.execute(() => window.__ytRates.length);
    ok(!(await press(">", "Period")), "⇧. off the video didn't type");
    ok(!(await press("<", "Comma")), "⇧, off the video didn't type");
    equal(
      await browser.execute(() => window.__ytRates.length),
      rates,
      "off the video the speed changed",
    );

    await hover(true);
    ok(await press(">", "Period"), "⇧. over the video typed");
    await browser.waitUntil(
      async () => browser.execute((n) => window.__ytRates.length > n, rates),
      {
        timeout: 5_000,
        timeoutMsg: "⇧. over the video didn't change its speed",
      },
    );
    // Back to the speed it had, for the next video.
    ok(await press("<", "Comma"), "⇧, over the video typed");
    await hover(false);
  });

  it("YT-31 ⌘S works after clicking the video, and with nothing focused", async function () {
    const view = () =>
      browser.execute(() => {
        const content = document
          .querySelector(".video-band")
          .closest("[data-pane]")
          .querySelector(".cm-content");
        return {
          focused: document.activeElement === content,
          active: document.activeElement?.tagName,
          pins: (content.cmTile.root.view.state.doc.toString().match(/\^yt-\d+/g) ?? []).length,
        };
      });
    const fromPage = (data) =>
      browser.execute((message) => {
        const frame = document.querySelector(".video-band iframe");
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "pensee-yt", ...message },
            origin: new URL(frame.src).origin,
            source: frame.contentWindow,
          }),
        );
      }, data);
    await caret(0);
    // A click on the video: its frame takes focus, its page says "release".
    // With nothing tracked before (the note just opened), focus goes to the
    // note, not left in the frame where keys reach only YouTube's page.
    await browser.execute(() => document.querySelector(".video-band iframe").focus());
    await fromPage({ type: "release" });
    ok(
      (await view()).focused,
      `focus stayed in ${(await view()).active} after a click on the video`,
    );

    // ⌘S pressed while focus was still in the page: the page passes it on.
    const playing = () => browser.execute(() => window.__ytReports.at(-1)?.playing === true);
    const wasPlaying = await playing();
    const pins = (await view()).pins;
    await fromPage({ type: "key", shift: false });
    if (wasPlaying) {
      await browser.waitUntil(async () => (await view()).pins > pins, {
        timeout: 5_000,
        timeoutMsg: "⌘S from the video's page didn't pin",
      });
    } else {
      await browser.waitUntil(playing, {
        timeout: 20_000,
        timeoutMsg: "⌘S from the video's page didn't play it",
      });
    }

    // Nothing focused (a note opened from the sidebar): ⌘S still means
    // the video on screen.
    const before = await playing();
    await browser.execute(() => document.activeElement?.blur());
    equal((await view()).active, "BODY");
    await pressCmd("s");
    await browser.waitUntil(async () => (await playing()) !== before, {
      timeout: 20_000,
      timeoutMsg: "⌘S with nothing focused did nothing",
    });

    // Focus left on the sidebar row the note was opened from: the same.
    const again = await playing();
    ok(
      await browser.execute(() => {
        const row = document.querySelector(
          "[data-sidebar-surface] button, [data-sidebar-surface] a",
        );
        row?.focus();
        return document.activeElement === row;
      }),
      "no sidebar row to focus",
    );
    await pressCmd("s", { inFocus: true });
    await browser.waitUntil(async () => (await playing()) !== again, {
      timeout: 20_000,
      timeoutMsg: "⌘S with a sidebar row focused did nothing",
    });
  });

  it("YT-32 ⌘S the moment a video note opens shows a ring at once, gone once it plays", async function () {
    await openNote("Welcome");
    await openNote(NOTE);
    await $(".video-band iframe").waitForExist({ timeout: 15_000 });
    const since = await browser.execute(() => window.__ytReports.length);
    const pressed = Date.now();
    await pressCmd("s", { inFocus: true });
    // In the DOM at once; it fades in after 150ms so a quick start never
    // flashes it.
    ok(
      await browser.execute(() =>
        [...document.querySelectorAll(".video-starting")].some((ring) => ring.checkVisibility()),
      ),
      "no ring over the video right after ⌘S",
    );
    await browser.waitUntil(
      async () =>
        browser.execute(
          (from) =>
            window.__ytReports.slice(from).some((r) => r.playing) &&
            !document.querySelector(".video-starting"),
          since,
        ),
      { timeout: 20_000, timeoutMsg: "the video didn't start, or the ring stayed once it did" },
    );
    console.log(`YT-32 ⌘S → playing in ${Date.now() - pressed}ms`);
  });

  it("YT-27 ⌘⇧S puts a screenshot of the video in the note, pinned to the moment", async function () {
    const root = await workspaceRoot();
    await caret(0);
    // Playing, so the picture is YouTube's video, not the page's poster:
    // ⌘S plays a paused video.
    const playing = () => browser.execute(() => window.__ytReports.at(-1)?.playing === true);
    if (!(await playing())) await pressCmd("s", { inFocus: true });
    await browser.waitUntil(
      async () => browser.execute(() => window.__ytReports.at(-1)?.state === 1),
      { timeout: 20_000, timeoutMsg: "the video didn't play (needs YouTube)" },
    );
    await browser.pause(1_500);
    await pressCmd("S", { shift: true, inFocus: true });
    const line = await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const view = document
            .querySelector(".video-band")
            .closest("[data-pane]")
            .querySelector(".cm-content").cmTile.root.view;
          return (
            view.state.doc
              .toString()
              .split("\n")
              .find((text) => /!\[\d+:\d\d\]\(.*\.png>?\) \^yt-\d+$/.test(text)) ?? false
          );
        }),
      { timeout: 10_000, timeoutMsg: "no pinned screenshot in the note" },
    );
    const [, time, path, pin] = /!\[(\d+:\d\d)\]\(<?(.+?\.png)>?\) \^yt-(\d+)$/.exec(line);
    const [m, sec] = time.split(":").map(Number);
    equal(m * 60 + sec, Number(pin), "the picture's time and its pin disagree");
    ok(path.startsWith(`${NOTE}-assets/`), `not in the note's assets folder (${path})`);

    // A picture, not a blank: as wide as the video, many colours.
    const file = await invoke("read_file_data_url", { path: `${root}/${path}` });
    ok(file.ok, `the screenshot isn't on disk (${file.error})`);
    // executeAsync: the plugin doesn't await a promise from execute.
    const picture = await browser.executeAsync((url, done) => {
      const image = new Image();
      image.onerror = () => done({ width: 0, colours: 0, frameWidth: 0 });
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        const colours = new Set();
        for (let i = 0; i < data.length; i += 4 * 97)
          colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
        const frame = document.querySelector(".video-frame").getBoundingClientRect();
        done({ width: image.naturalWidth, colours: colours.size, frameWidth: frame.width });
      };
      image.src = url;
    }, file.value);
    ok(picture.width >= picture.frameWidth - 2, `smaller than the video (${picture.width}px)`);
    ok(picture.colours > 50, `the screenshot is blank (${picture.colours} colours)`);
    if (process.env.SHOTS) {
      execSync(`cp "${root}/${path}" "${process.env.SHOTS}/yt-27-screenshot.png"`);
      await browser.saveScreenshot(`${process.env.SHOTS}/yt-27-note.png`);
    }
  });
});

describe("YouTube notes: where a video was left", function () {
  before(async function () {
    await workspaceRoot();
    await forgetVideoPositions();
    await openNote(NOTE);
    await waitForBox();
  });

  it("YT-34 a video closed while playing opens again where it was left", async function () {
    await markShownBand();
    // Show the box beside the video, wherever an earlier journey left it.
    if ((await boxState()).hidden) await (await showTranscriptButton()).click();
    await waitForBox();
    // Play from 1:00, the third line.
    await browser.execute(() =>
      [...document.querySelectorAll(".transcript-box-line")]
        .filter((line) => line.checkVisibility())[2]
        ?.click(),
    );
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => shownBand().querySelector(".player-key")?.textContent.startsWith("Pin") ?? false,
        ),
      { timeout: 30_000, timeoutMsg: "the video never played (needs YouTube)" },
    );
    await browser.pause(1_500);
    await pressCmd("w");
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => ![...document.querySelectorAll(".video-band")].some((b) => b.checkVisibility()),
        ),
      { timeout: 5_000, timeoutMsg: "⌘W didn't close the video note" },
    );
    await openNote(NOTE);
    await waitForBox();
    await markShownBand();
    const src = await browser.execute(() => shownBand().querySelector("iframe").src);
    const from = Number(new URL(src).searchParams.get("t"));
    ok(from >= 60 && from < 120, `the video didn't open where it was left: ${src}`);
    ok((await boxState()).now >= 2, "the transcript isn't at the line where the video was left");
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-34-resumed.png`);
  });
});

describe("YouTube notes: a link with a timestamp", function () {
  before(async function () {
    await workspaceRoot();
    await forgetVideoPositions();
    await openNote("Start at a time");
    await $(".video-band iframe").waitForExist({ timeout: 15_000 });
    await browser.execute(() => {
      window.__ytStarts = [];
      addEventListener("message", (e) => {
        if (e.data?.source === "pensee-yt" && e.data.type === "state")
          window.__ytStarts.push(e.data);
      });
    });
  });

  it("YT-22 a link ending in t=210 plays from 3:30", async function () {
    const src = await $(".video-band iframe").getAttribute("src");
    equal(
      new URL(src).searchParams.get("t"),
      "210",
      `the player page wasn't told to start at 210: ${src}`,
    );
    await browser.waitUntil(async () => browser.execute(() => window.__ytStarts.length > 0), {
      timeout: 30_000,
      timeoutMsg: "the player page never reported (needs YouTube)",
    });
    // Play, as the keys row says (⌘S while paused), from the note.
    await browser.execute(() => {
      const view = document
        .querySelector(".video-band")
        .closest("[data-pane]")
        .querySelector(".cm-content").cmTile.root.view;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });
    await pressCmd("s");
    let last = null;
    await browser
      .waitUntil(
        async () => {
          last = await browser.execute(() => window.__ytStarts.at(-1));
          return last.playing && last.t >= 209 && last.t < 240;
        },
        { timeout: 30_000 },
      )
      .catch(() => {
        throw new Error(`the video didn't play from 3:30; last report ${JSON.stringify(last)}`);
      });
  });

  /** The newest report from the player on screen: the note just opened.
   *  Other notes' players stay mounted, hidden, in their tabs. */
  async function frontReport() {
    return browser.execute(() => {
      const frame = [...document.querySelectorAll(".video-band iframe")].find((f) =>
        f.checkVisibility(),
      );
      const mine = window.__ytStartSources
        .map((source, i) => (source === frame?.contentWindow ? window.__ytStarts[i] : null))
        .filter(Boolean);
      return mine.at(-1) ?? null;
    });
  }

  async function waitForPlayFrom(seconds, how) {
    let last = null;
    await browser
      .waitUntil(
        async () => {
          last = await frontReport();
          return !!last && last.playing && last.t >= seconds - 1 && last.t < seconds + 30;
        },
        { timeout: 30_000 },
      )
      .catch(() => {
        throw new Error(
          `${how}: the video didn't play from ${seconds}s; last report ${JSON.stringify(last)}`,
        );
      });
  }

  it("YT-23 ⌘N, a timestamped link to a video already in Library, ⌘↵ plays it from that time", async function () {
    await browser.execute(() => {
      window.__ytStartSources = [];
      window.__ytStarts = [];
      addEventListener("message", (e) => {
        if (e.data?.source === "pensee-yt" && e.data.type === "state") {
          window.__ytStartSources.push(e.source);
          window.__ytStarts.push(e.data);
        }
      });
    });
    // Speech talk and Start at a time both link this video (the one that
    // plays in the e2e app): Library opens whichever it finds first.
    await openNote("Welcome");
    await pressCmd("n");
    const title = 'input.composer-title[aria-label="Title"]';
    await $(title).waitForExist({ timeout: 5_000 });
    await fillField(title, "https://youtu.be/aqz-KE-bpKQ?si=abc&t=95");
    await browser.execute((sel) => {
      document.querySelector(sel).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, title);
    await waitForPlayFrom(95, "⌘N");
  });

  it("YT-24 ⌘O, the same link with another time, Already in your Library plays it from there", async function () {
    await openNote("Welcome");
    await pressCmd("o");
    const input = await $("[cmdk-input]");
    await input.waitForExist({ timeout: 5_000 });
    await input.setValue("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=2m30s");
    const row = await $('//*[@cmdk-item][starts-with(@data-value,"library:open:")]');
    await row.waitForExist({ timeout: 10_000 });
    await row.click();
    await waitForPlayFrom(150, "⌘O");
  });
});
