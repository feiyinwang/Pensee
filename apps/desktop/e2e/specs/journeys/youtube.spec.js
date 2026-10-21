// YouTube notes (docs/qa/user-journeys.md § YouTube notes — YT): the
// transcript box. A note's `<details>` transcript shows as a teleprompter
// that follows the video, seeks on a click, copies and hands questions to the
// Agent; beside the video in a wide pane, under it in a narrow one. The
// player's position is the app's own estimate after a seek, so these
// journeys don't wait on YouTube (YT-14, the language menu, does).
import { equal, ok } from "node:assert/strict";
import { execSync } from "node:child_process";
import {
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
      return state.shown === 1 && (state.collapsed || state.lines.length > 0);
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

/** The button named `label` in the box on screen (beside the video its
 *  buttons are icons, named by aria-label). */
async function shownButton(label) {
  const buttons = await $$(
    `//section[contains(@class,'transcript-box')]//button[@aria-label='${label}' or normalize-space(.)='${label}']`,
  );
  for (const button of buttons) if (await button.isDisplayed()) return button;
  throw new Error(`no ${label} button on screen in the transcript box`);
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
    equal(row.keys.slice(1).join(" · "), "Slower⇧, · Faster⇧.", "the speed keys in full");
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
      const scroller = document.querySelector(".video-band").parentElement.getBoundingClientRect();
      return { frameTop: frame.top, boxTop: box.top, scrollerTop: scroller.top };
    });
    equal(
      Math.round(pinned.boxTop),
      Math.round(pinned.frameTop),
      "the box didn't stay by the video",
    );
    ok(pinned.boxTop >= pinned.scrollerTop - 1, "the box scrolled away");
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

  it("YT-12 folding the box leaves its header, and stays folded", async function () {
    await setPaneWidth(BESIDE_MIN_WIDTH + 200);
    await browser.waitUntil(async () => (await boxState()).placement === "beside", {
      timeout: 3_000,
    });
    const fold = await $("//section[@data-placement='beside']//button[@aria-expanded='true']");
    await fold.click();
    // Folded, the transcript goes back under the video as just its header.
    await browser.waitUntil(async () => (await boxState()).collapsed, {
      timeout: 3_000,
      timeoutMsg: "the box didn't fold",
    });
    let state = await boxState();
    equal(state.placement, "note", "a folded box stays beside the video");
    await browser.pause(300);
    const height = await browser.execute(
      () =>
        [...document.querySelectorAll(".transcript-box-body")]
          .find((el) => el.closest(".transcript-box").checkVisibility())
          ?.getBoundingClientRect().height ?? -1,
    );
    ok(height >= 0 && height < 2, `the folded box still shows its lines (${height}px)`);
    if (process.env.SHOTS) await browser.saveScreenshot(`${process.env.SHOTS}/yt-12-folded.png`);
    // Another visit finds it folded.
    await openNote("Welcome");
    await openNote(NOTE);
    await waitForBox();
    state = await boxState();
    ok(state.collapsed, "the box unfolded on its own");
    const unfold = await $("//section[@data-placement='note']//button[@aria-expanded='false']");
    await unfold.click();
    await browser.waitUntil(async () => (await boxState()).placement === "beside", {
      timeout: 3_000,
      timeoutMsg: "unfolded in a wide pane, the box didn't go back beside the video",
    });
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

describe("YouTube notes: the arrow keys over the video", function () {
  before(async function () {
    // The workspace first: ⌘O does nothing until it has loaded.
    await workspaceRoot();
    await openNote(NOTE);
    await $(".video-band iframe").waitForExist({ timeout: 15_000 });
    await browser.execute(() => {
      window.__ytReports = [];
      addEventListener("message", (e) => {
        if (e.data?.source === "pensee-yt" && e.data.type === "state")
          window.__ytReports.push(e.data);
      });
    });
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
   *  in [min, max]; returns the last one. */
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
    return browser.execute((from) => window.__ytReports.slice(from).at(-1), since);
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
});
