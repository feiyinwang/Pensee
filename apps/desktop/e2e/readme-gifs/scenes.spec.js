// Films the README GIFs (assets/readme/*.gif) from the e2e build on the demo
// vault (seed-demo.mjs). Each scene is a run of WebDriver screenshots (the
// page only, never the desktop), named NNNN-<ms>.png so stitch.py can replay
// them at their real pace. Run it through film.sh, one scene per app launch.
// Typing is the exception: a screenshot takes 100–400ms, so typing a word a
// frame shows the text in jumps with stalls between. typeLive() types a few
// letters a frame and stamps each frame TYPE_STEP_MS after the last, so the
// GIF types at an even pace however slow the screenshots were.
//
// Unlike the journey specs, this one brings the app window to front before
// each step: a window in the background paints no frames, so its columns
// stay at opacity 0 and the reader's pill never shows. While it is in front,
// the user's own keys and clicks land in the app too.
import { ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  invoke,
  pressCmd,
  typeInEditor,
  waitForTitle,
  workspaceRoot,
} from "../specs/journeys/_helpers.js";

const AI_TIMEOUT = 90_000;
const FRAMES = process.env.FRAMES;
const APP = process.env.PENSEE_E2E_APP;
/** Letters typed per frame, and how long each such frame shows. */
const TYPE_CHARS = 2;
const TYPE_STEP_MS = 70;
let scene = "";
let n = 0;
let marks = {};
let regions = {};
// The scene's clock: wall time minus the time typing frames didn't take.
let lag = 0;
let lastStamp = 0;

/** Frames go to $FRAMES/<name>/, with the page's size in CSS pixels beside
 *  them (viewport.json): stitch.py crops in CSS pixels whatever the screen's
 *  scale was. */
async function startScene(name) {
  ok(FRAMES, "FRAMES is not set: run this spec through readme-gifs/film.sh");
  scene = name;
  n = 0;
  marks = {};
  regions = {};
  lag = 0;
  lastStamp = 0;
  mkdirSync(`${FRAMES}/${name}`, { recursive: true });
  const viewport = await browser.execute(() => ({ width: innerWidth, height: innerHeight }));
  writeFileSync(`${FRAMES}/${name}/viewport.json`, JSON.stringify(viewport));
}
/** One frame, stamped with the scene's clock; `step` stamps it that many ms
 *  after the frame before, whatever time really passed. */
async function shot(step) {
  const b64 = await browser.takeScreenshot();
  const now = Date.now();
  if (step !== undefined) lag = now - (lastStamp + step);
  lastStamp = now - lag;
  writeFileSync(
    `${FRAMES}/${scene}/${String(n++).padStart(4, "0")}-${lastStamp}.png`,
    Buffer.from(b64, "base64"),
  );
}
/** Names the next frame, so stitch.py can cut the GIF there (--until). */
function mark(name) {
  marks[name] = n;
  writeFileSync(`${FRAMES}/${scene}/marks.json`, JSON.stringify(marks));
}
/** Saves where the player and the lines under it are now (CSS px), so
 *  stitch.py can crop to them (--crop @name) whatever the layout was. */
async function saveRegion(name) {
  regions[name] = await browser.execute(() => {
    const band = document.querySelector(".video-band");
    const pane = band.closest("[data-pane]") ?? band.parentElement;
    const lines = [...pane.querySelectorAll(".cm-line")].filter((l) => l.textContent.trim());
    const last = lines[lines.length - 1].getBoundingClientRect();
    const bottom = Math.min(last.bottom + 44, innerHeight);
    // A podcast's card sits in the text column: crop to it. A video is as
    // wide as the pane.
    const card = band.querySelector(".podcast-card")?.getBoundingClientRect();
    if (card) return [card.left - 32, Math.max(card.top - 24, 0), card.right + 32, bottom];
    const side = pane.getBoundingClientRect();
    return [side.left, Math.max(band.getBoundingClientRect().top - 8, 0), side.right, bottom];
  });
  writeFileSync(`${FRAMES}/${scene}/regions.json`, JSON.stringify(regions));
}
/** Screenshot as fast as WebDriver allows for `ms`. */
async function film(ms) {
  front();
  const end = Date.now() + ms;
  do await shot();
  while (Date.now() < end);
}
/** One frame every `every` ms until `test` passes. */
async function filmUntil(test, timeout, every = 700) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    await shot();
    if (await test()) return;
    await browser.pause(every);
  }
  throw new Error(`scene ${scene}: timed out`);
}
/** Brings the e2e app's window to front, so it paints frames. */
function front() {
  const pid = execFileSync("pgrep", ["-n", "-f", APP]).toString().trim();
  execFileSync("osascript", [
    "-e",
    `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
  ]);
}

async function readFile(path) {
  const result = await invoke("read_file", { path });
  ok(result.ok, `read_file ${path} failed: ${result.error}`);
  return result.value.content;
}

async function openViaPalette(name) {
  await pressCmd("o");
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue(name);
  const item = await $(`//*[@cmdk-item][contains(., "${name}")]`);
  await item.waitForExist({ timeout: 5_000 });
  await item.click();
  await waitForTitle(name);
}

/** Click just after `text` in the visible line that contains it, the way a
 *  user puts the caret there. The line is scrolled to where the click lands
 *  on it, not under a video note's sticky player or the bottom bar. */
async function caretAfter(text) {
  await browser.execute((needle) => {
    const editor = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
    const line = [...editor.querySelectorAll(".cm-line")].find((l) =>
      l.textContent.includes(needle),
    );
    if (!line) throw new Error(`no line with "${needle}"`);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + needle.length - 1);
      range.setEnd(node, at + needle.length);
      let scroller = line.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      const hits = () => {
        const r = range.getBoundingClientRect();
        const hit = document.elementFromPoint(r.right - 1, r.top + r.height / 2);
        return !!hit && line.contains(hit);
      };
      for (const ratio of [0.75, 0.5, 0.6, 0.4]) {
        if (!scroller) break;
        const lineTop = line.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTop += lineTop - scroller.clientHeight * ratio;
        if (hits()) break;
      }
      const box = range.getBoundingClientRect();
      const point = {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
        clientX: box.right - 1,
        clientY: box.top + box.height / 2,
      };
      const target = document.elementFromPoint(point.clientX, point.clientY) ?? line;
      target.dispatchEvent(new MouseEvent("mousedown", point));
      target.dispatchEvent(new MouseEvent("mouseup", point));
      target.dispatchEvent(new MouseEvent("click", point));
      return;
    }
    throw new Error(`"${needle}" is split across nodes`);
  }, text);
  await browser.pause(150);
}

/** Click into the last line matching `selector` at the end of its first
 *  words (an echo's bold label; the end of the line is its [[link]], which a
 *  click would open), then End: the caret goes past the hidden id (^ai-e-…),
 *  so Enter starts a line under it. */
async function caretAtEndOfLast(selector) {
  await browser.execute((sel) => {
    const lines = [...document.querySelectorAll(sel)];
    const line = lines[lines.length - 1];
    if (!line) throw new Error(`no line matches ${sel}`);
    line.scrollIntoView({ block: "center" });
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let first = null;
    let node;
    while (!first && (node = walker.nextNode())) {
      if (node.data.trim().length > 1 && !node.parentElement.closest("a, [class*='link']")) {
        first = node;
      }
    }
    if (!first) throw new Error(`no words to click in ${sel}`);
    const range = document.createRange();
    range.setStart(first, first.data.length - 1);
    range.setEnd(first, first.data.length);
    const box = range.getBoundingClientRect();
    const point = {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 1,
      clientX: box.right - 1,
      clientY: box.top + box.height / 2,
    };
    const target = document.elementFromPoint(point.clientX, point.clientY) ?? line;
    target.dispatchEvent(new MouseEvent("mousedown", point));
    target.dispatchEvent(new MouseEvent("mouseup", point));
    target.dispatchEvent(new MouseEvent("click", point));
  }, selector);
  await browser.pause(150);
  await key("End");
}

/** Click into the empty line of yours that shows `words` (what the pen waits
 *  for there), just left of those words: the caret goes on that line. */
async function caretInWaiting(words) {
  await browser.execute((needle) => {
    const hint = [...document.querySelectorAll(".cm-pen-waiting")].find((w) =>
      w.textContent.includes(needle),
    );
    if (!hint) throw new Error(`no waiting line with "${needle}"`);
    hint.scrollIntoView({ block: "center" });
    const box = hint.getBoundingClientRect();
    const point = {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 1,
      clientX: box.left - 2,
      clientY: box.top + box.height / 2,
    };
    const target = document.elementFromPoint(point.clientX, point.clientY) ?? hint.parentElement;
    target.dispatchEvent(new MouseEvent("mousedown", point));
    target.dispatchEvent(new MouseEvent("mouseup", point));
    target.dispatchEvent(new MouseEvent("click", point));
  }, words);
  await browser.pause(150);
}

const waitingShows = (words) =>
  browser.execute(
    (needle) =>
      [...document.querySelectorAll(".cm-pen-waiting")].some((w) => w.textContent.includes(needle)),
    words,
  );

/** Put the caret after `text` and open the pen's box there, checking the box
 *  opened on that line (the tinted words): a click can land a line off while
 *  the page settles, and the pen would then work on the wrong line. */
async function armOn(text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await caretAfter(text);
    await key(".", { meta: true });
    await waitForBox();
    const armed = await browser.execute(() =>
      [...document.querySelectorAll(".cm-pen-armed")].map((el) => el.textContent).join(" "),
    );
    if (armed.includes(text)) return;
    await key("Escape");
    await browser.pause(300);
  }
  throw new Error(`the pen's box never opened on "${text}"`);
}

/** A key pressed where the keyboard is: the pen's box when it's open, else
 *  the editor in front. */
async function key(name, { meta = false, shift = false, alt = false } = {}) {
  await browser.execute(
    (k, metaKey, shiftKey, altKey) => {
      const editor = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
      const active = document.activeElement;
      const target = active?.closest?.(".cm-pen-pop") ? active : editor;
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: k,
          metaKey,
          shiftKey,
          altKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    name,
    meta,
    shift,
    alt,
  );
  await browser.pause(80);
}

/** The pen's box is loaded on first use: wait for its field. */
async function waitForBox() {
  await browser.waitUntil(
    () => browser.execute(() => !!document.querySelector(".cm-pen-pop .pen-box-input")),
    { timeout: 5_000, timeoutMsg: "the pen's box didn't open" },
  );
}

/** Type `text` at the caret a few letters a frame, at an even pace. */
async function typeLive(text) {
  front();
  for (let at = 0; at < text.length; at += TYPE_CHARS) {
    await typeInEditor(text.slice(at, at + TYPE_CHARS), { atEnd: false });
    await shot(TYPE_STEP_MS);
  }
}

const barText = () =>
  browser.execute(() => {
    const bars = [...document.querySelectorAll(".pen-hint")].filter((el) => el.offsetParent);
    return bars.map((el) => el.textContent).join(" | ");
  });

async function waitForDisk(path, test, message, timeout = 8_000) {
  let last = "";
  // What the bar said along the way: the pen's messages last 4 seconds, so a
  // failure would otherwise only show the resting hint.
  const said = [];
  try {
    await browser.waitUntil(
      async () => {
        const bar = await barText();
        if (bar && said[said.length - 1] !== bar) said.push(bar);
        try {
          last = await readFile(path);
        } catch (error) {
          last = `(read failed: ${String(error)})`;
          return false;
        }
        return test(last);
      },
      { timeout, interval: 300 },
    );
  } catch {
    throw new Error(`${message}\n--- file ---\n${last}\n--- bar said ---\n${said.join("\n")}`);
  }
  return last;
}

const visiblePins = () =>
  browser.execute(
    () => [...document.querySelectorAll(".cm-video-pin")].filter((p) => p.checkVisibility()).length,
  );

const playing = () =>
  browser.execute(() =>
    [...document.querySelectorAll(".player-keys")].some((k) => k.textContent.includes("Pin")),
  );

/** ⌘S plays. A player that isn't ready yet ignores ⌘S: press it again until
 *  the keys row under it says Pin (playing). */
async function playWithKeys() {
  front();
  await pressCmd("s");
  for (let attempt = 0; attempt < 5 && !(await playing()); attempt++) {
    await browser.pause(1500);
    if (!(await playing())) await pressCmd("s");
  }
}

/** Click the transcript line that says `words`: the video plays from it.
 *  The box is scrolled to it first, as you would; the caret then goes back
 *  to the end of the note, where the pin goes. */
async function playFromTranscript(words) {
  front();
  await browser.execute((needle) => {
    const line = [...document.querySelectorAll(".transcript-box-line")].find((l) =>
      l.textContent.includes(needle),
    );
    if (!line) throw new Error(`no transcript line says "${needle}"`);
    const list = line.closest(".transcript-box-lines");
    list.scrollTop += line.getBoundingClientRect().top - list.getBoundingClientRect().top - 8;
    line.click();
  }, words);
  await browser.waitUntil(playing, { timeout: 8_000, timeoutMsg: "the line didn't play" });
  await typeInEditor("", { atEnd: true });
}

/** `play` starts the player; after `ms`, ⌘S pins the moment on the caret's
 *  empty line and pauses, and `text` is written there. `newLine` starts a
 *  line first: End, since Enter mid-line would split the line before its
 *  hidden ^yt- id. */
async function listenPinWrite(ms, text, newLine, play = playWithKeys) {
  const before = await visiblePins();
  await play();
  if (newLine) {
    await key("End");
    await key("Enter");
  }
  await film(ms);
  front();
  await pressCmd("s");
  await browser.waitUntil(async () => (await visiblePins()) > before, {
    timeout: 8_000,
    timeoutMsg: "⌘S didn't pin the line",
  });
  await film(700);
  await typeLive(text);
  await film(500);
}

/** Click the first pin: the player seeks back to its moment. */
async function clickFirstPin() {
  front();
  await browser.execute(() => {
    const pin = [...document.querySelectorAll(".cm-video-pin")].find((p) => p.checkVisibility());
    pin.scrollIntoView({ block: "center" });
    pin.click();
  });
}

/** Close what the app opened with, then open `name` on its own. */
async function openFresh(name) {
  await pressCmd("w");
  await browser.pause(400);
  await pressCmd("w");
  await browser.pause(400);
  front();
  await openViaPalette(name);
}

describe("README GIFs", function () {
  // film.sh stitches a scene only when this marks it passed: a run another
  // QA run cut off still exits 0.
  afterEach(function () {
    if (this.currentTest?.state === "passed") writeFileSync(`${FRAMES}/${scene}/passed`, "");
  });

  before(async function () {
    await $('section[aria-label="Spaces"]').waitForExist({ timeout: 10_000 });
    // The plugin sizes the window in device pixels: 2880×1800 is 1440×900 on
    // a 2× screen (and larger frames on a screen scaled further).
    await browser.setWindowSize(2880, 1800);
    await browser.pause(600);
    front();
    await $(".app-splash").waitForExist({ timeout: 10_000, reverse: true });
    await browser.pause(600);
  });

  // Check: on a claim, the pen writes what papers say for and against it,
  // and your call goes under them.
  it("check", async function () {
    await startScene("check");
    await openViaPalette("How I learn");
    await browser.pause(800);
    await film(800);
    await armOn("the best way to remember them.");
    await film(900);
    await key("@", { shift: true });
    await film(700);
    await key("Enter");
    await filmUntil(() => waitingShows("Your call"), AI_TIMEOUT, 1200);
    await film(1500);
    // A paper's pill shows the paper on hover.
    await browser.execute(() =>
      document
        .querySelector(".cm-pen-cite")
        ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    await film(2600);
    await caretInWaiting("Your call");
    await typeLive("So quiz myself instead of rereading.");
    await film(1500);
    const root = await workspaceRoot();
    console.log("FINAL CHECK\n" + (await readFile(`${root}/Notes/How I learn.md`)));
  });

  // Connect: the pen brings back what your other notes say about a line, and
  // you write how they connect.
  it("connect", async function () {
    await startScene("connect");
    await openViaPalette("How I learn");
    await browser.pause(800);
    await film(800);
    await armOn("once I've written about it.");
    await film(900);
    await key("[");
    await film(700);
    await key("Enter");
    await filmUntil(
      () => browser.execute(() => document.querySelectorAll(".cm-line.cm-pen-e").length > 0),
      AI_TIMEOUT,
      1200,
    );
    await film(2500);
    await caretAtEndOfLast(".cm-line.cm-pen-e");
    await key("Enter");
    const columns = await browser.execute(
      () => document.querySelectorAll("[data-column-tab]").length,
    );
    ok(columns === 1, `a click opened another note (${columns} columns)`);
    await typeLive("Same thing twice: I understand it once I've said it myself.");
    await film(1500);
    const root = await workspaceRoot();
    console.log("FINAL CONNECT\n" + (await readFile(`${root}/Notes/How I learn.md`)));
  });

  // The second pen: ask about a line, write your take beside the answer,
  // then Tab combines the two into one list.
  it("pen", async function () {
    await startScene("pen");
    await openViaPalette("Questions");
    await browser.pause(800);
    await film(800);
    await armOn("why does sleep help memory?");
    await film(1000);
    await key("!", { shift: true });
    await film(700);
    await key("Enter");
    await filmUntil(() => waitingShows("Your take"), AI_TIMEOUT, 1200);
    await film(1500);
    await caretInWaiting("Your take");
    await typeLive("I guess the brain replays what you learned while you sleep");
    await film(600);
    await key("Enter");
    const root = await workspaceRoot();
    const path = `${root}/Notes/Questions.md`;
    await filmUntil(async () => /\^ai-r-[a-z0-9]{4}/.test(await readFile(path)), AI_TIMEOUT, 1200);
    // Both open side by side, with Combine offered under them: hold to read.
    await browser.waitUntil(() => waitingShows("Put the two together"), {
      timeout: 5_000,
      timeoutMsg: "the empty line should offer Combine",
    });
    await film(3000);
    // Tab on that line: the answer and the take become one list of points.
    await caretInWaiting("Put the two together");
    await film(900);
    await key("Tab");
    await filmUntil(() => waitingShows("Add a point"), AI_TIMEOUT, 1200);
    await film(1500);
    console.log("FINAL NOTE\n" + (await readFile(path)));
  });

  // A book: highlight a sentence in the PDF, it lands in the note; a click on
  // it brings the book back there, and your own line goes under it.
  it("book", async function () {
    await startScene("book");
    await $('button[data-space-key="library"]').click();
    const books = await $('button[data-value="books"]');
    await books.waitForExist({ timeout: 10_000 });
    await books.click();
    const card = await $('//button[.//*[normalize-space(.)="The Elements of Style"]]');
    await card.waitForExist({ timeout: 10_000 });
    // Hide the sidebar so the note and its book both fit side by side.
    await pressCmd("[");
    await browser.pause(800);
    await film(1000);
    front();
    await card.click();
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          [...document.querySelectorAll(".book-epub-section p")].some((p) =>
            p.textContent.includes("Vigorous writing"),
          ),
        ),
      { timeout: 15_000, timeoutMsg: "the book's text never showed" },
    );
    await film(1800);
    // Drag across the sentence, a few words at a time. The window comes to
    // front first: activating it hands focus back to the note's editor,
    // which would put its caret over a selection made before.
    front();
    await browser.pause(300);
    await browser.execute(() => document.activeElement?.blur?.());
    const phrase = "Vigorous writing is concise.";
    const selectUpTo = (upto, release) =>
      browser.execute(
        (needle, end, up) => {
          const para = [...document.querySelectorAll(".book-epub-section p")].find((p) =>
            p.textContent.includes(needle),
          );
          const node = [...para.childNodes].find(
            (n) => n.nodeType === Node.TEXT_NODE && n.data.includes(needle),
          );
          const at = node.data.indexOf(needle);
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + end);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          if (!up) return;
          const box = range.getBoundingClientRect();
          para.closest(".book-reader-scroller").dispatchEvent(
            new MouseEvent("mouseup", {
              bubbles: true,
              button: 0,
              clientX: box.right - 2,
              clientY: box.top + box.height / 2,
            }),
          );
        },
        phrase,
        upto,
        release,
      );
    for (const upto of [4, 9, 16, 20, 25]) {
      await selectUpTo(upto, false);
      await shot();
    }
    const highlight = await $('//button[normalize-space(.)="Highlight"]');
    for (let attempt = 0; attempt < 5 && !(await highlight.isExisting()); attempt++) {
      await selectUpTo(phrase.length, true);
      await browser.pause(400);
    }
    await highlight.waitForExist({ timeout: 2_000 });
    await film(900);
    front();
    await highlight.click();
    const root = await workspaceRoot();
    const path = `${root}/Library/The Elements of Style.md`;
    await waitForDisk(
      path,
      (t) => /Vigorous writing is concise\. \^bk-[ps]/.test(t),
      "the highlight should land in the note",
    );
    await film(1800);
    // Read on: the sentence scrolls out of sight.
    await browser.execute(() =>
      document.querySelector(".book-reader-scroller").scrollBy({ top: 600, behavior: "smooth" }),
    );
    await film(1600);
    // Back in the note, a click on the highlight brings the book back to it.
    // A scripted click doesn't move column focus: a pointerdown on the
    // note's column does.
    await browser.execute(() => {
      const editor = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
      editor.closest(".tab-column").dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
          button: 0,
        }),
      );
    });
    front();
    await caretAfter("Vigorous writing is concise");
    await film(2200);
    // And your own line goes under it: End first, since Enter mid-line would
    // split the line before its hidden ^bk- id.
    front();
    await key("End");
    await key("Enter");
    await key("Tab");
    await typeLive("My drafts say each thing three times. Say it once, then stop.");
    await film(1500);
    console.log("FINAL BOOK\n" + (await readFile(path)));
  });

  // A YouTube note: ⌘S plays and pins two moments with a line each, then a
  // pin seeks back. film.sh cuts the GIF at the pin click (mark "pin-click").
  it("youtube", async function () {
    await openFresh("Controlling Your Dopamine For Motivation, Focus & Satisfaction");
    await startScene("youtube");
    await browser.waitUntil(
      () => browser.execute(() => !!document.querySelector("iframe[src*='youtube']")),
      { timeout: 20_000, timeoutMsg: "no player" },
    );
    await browser.pause(3000);
    // Scroll the title and properties away: the video sticks to the top and
    // the lines being written get the room under it.
    await browser.execute(() => {
      const band = document.querySelector(".video-band");
      let scroller = band.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      scroller.scrollTop += band.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      // Past the point where it sticks, the video would cover the first lines
      // under it: back off by how far it moved off its place in the flow,
      // which the 1px sentinel just above it keeps.
      const sentinel = document.querySelector(".video-band-sentinel");
      const over = band.getBoundingClientRect().top - sentinel.getBoundingClientRect().top;
      if (over > 0) scroller.scrollTop -= over;
    });
    await browser.pause(400);
    // Its transcript comes in beside the video; the notes follow what he says
    // there: a study at 1:39:16 on rewarding children for drawing.
    front();
    await browser.execute(() =>
      [...document.querySelectorAll(".video-pin-button")]
        .find((b) => b.textContent.includes("Transcript"))
        .click(),
    );
    await browser.waitUntil(
      () => browser.execute(() => document.querySelectorAll(".transcript-box-line").length > 10),
      { timeout: 30_000, timeoutMsg: "the transcript never came in" },
    );
    await browser.pause(800);
    await film(1200);
    await listenPinWrite(
      6000,
      "Kids who loved drawing started getting a reward for it.",
      false,
      () => playFromTranscript("took kids that liked to draw"),
    );
    await listenPinWrite(6500, "Once the reward stopped, they drew less on their own.", true, () =>
      playFromTranscript("Then they stopped giving them the gold star"),
    );
    await saveRegion("notes");
    mark("pin-click");
    await clickFirstPin();
    await film(3000);
    const root = await workspaceRoot();
    console.log(
      "FINAL YT\n" +
        (await readFile(
          `${root}/Library/Controlling Your Dopamine For Motivation, Focus & Satisfaction.md`,
        )),
    );
  });

  // A podcast note: the same ⌘S pins over the episode's player.
  it("podcast", async function () {
    await openFresh("Andy Matuschak on why most learning tools fail");
    await startScene("podcast");
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const audio = document.querySelector(".podcast-band audio");
          return !!audio && audio.readyState >= 1;
        }),
      { timeout: 30_000, timeoutMsg: "the episode never loaded" },
    );
    // The notes follow what's said from 1:05:12 (the episode's transcript on
    // dwarkesh.com): Dwarkesh asks whether learning has to feel fun, or
    // whether some of it is misery you push through.
    await browser.execute(() => {
      document.querySelector(".podcast-band audio").currentTime = 3912;
    });
    await browser.pause(1500);
    await film(1200);
    front();
    await typeInEditor("", { atEnd: true });
    await listenPinWrite(5500, "Does learning have to feel fun?", false);
    await listenPinWrite(6000, "Or is some misery just part of learning?", true);
    await saveRegion("notes");
    mark("pin-click");
    await clickFirstPin();
    await film(2500);
    const root = await workspaceRoot();
    console.log(
      "FINAL POD\n" +
        (await readFile(`${root}/Library/Andy Matuschak on why most learning tools fail.md`)),
    );
  });

  // A board: drag the loose card into the slot after "Too many tabs open",
  // hold while the dock is offered, then drop.
  it("dock", async function () {
    await startScene("dock");
    await openViaPalette("Focus board");
    const preview = await $(".wr-board-card, .wr-board-image");
    await preview.waitForExist({ timeout: 10_000 });
    if ((await preview.getAttribute("class")).includes("wr-board-image")) {
      await browser.execute(() =>
        [...document.querySelectorAll(".wr-board-image-open")]
          .find((b) => b.textContent === "Open board")
          .click(),
      );
    } else await preview.click();
    await $('.wr-board-fullscreen [data-el="t1"]').waitForExist({ timeout: 10_000 });
    await browser.pause(1200);
    await browser.execute(() =>
      [
        ...document.querySelectorAll(
          ".wr-board-fullscreen [aria-label], .wr-board-fullscreen [title]",
        ),
      ]
        .find((b) =>
          /Zoom to fit/.test(b.getAttribute("aria-label") ?? b.getAttribute("title") ?? ""),
        )
        .click(),
    );
    await browser.pause(900);
    await film(900);
    // Drag along a curve, timed in the page so the screenshots catch it
    // moving. A synthetic pointer can't be captured: stub the capture calls.
    await browser.execute(() => {
      const svg = document.querySelector(".wr-board-fullscreen svg.wr-board-svg");
      svg.setPointerCapture = () => {};
      svg.releasePointerCapture = () => {};
      const r = (id) =>
        document.querySelector(`.wr-board-fullscreen [data-el="${id}"]`).getBoundingClientRect();
      const from = r("t1");
      const onto = r("m1");
      const zoom = onto.width / 220;
      const start = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
      const end = { x: onto.right + 80 * zoom + from.width / 2, y: onto.top + onto.height / 2 };
      const send = (type, x, y) =>
        svg.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: x,
            clientY: y,
          }),
        );
      send("pointerdown", start.x, start.y);
      const steps = 45;
      for (let i = 1; i <= steps; i++) {
        setTimeout(() => {
          const t = i / steps;
          const e = 1 - Math.pow(1 - t, 3);
          const x = start.x + (end.x - start.x) * e;
          const y = start.y + (end.y - start.y) * e - Math.sin(Math.PI * t) * 60;
          send("pointermove", x, y);
        }, i * 28);
      }
      setTimeout(() => send("pointerup", end.x, end.y), steps * 28 + 900);
    });
    await film(4200);
  });
});
