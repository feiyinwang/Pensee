// The second pen (PEN in docs/qa/user-journeys.md, SPECs/second-pen-spec.md):
// ⌘. then one key in a note. The journeys that wait on Claude (AI_TIMEOUT)
// run the real pen, so they need Claude Code signed in on this Mac.
import { ok } from "node:assert/strict";
import { invoke, pressCmd, typeInEditor, waitForTitle, workspaceRoot } from "./_helpers.js";

const AI_TIMEOUT = 60_000;

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
 *  user puts the caret there. (A DOM selection set from a script is ignored
 *  while the window isn't in front.) */
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
      // Low in the window: a video note's sticky player covers the top, the
      // bottom bar the last few lines.
      let scroller = line.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      // Somewhere the click lands on the line itself, not under a sticky
      // video at the top or the bottom bar.
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

/** Shift-click just after `text`: the selection now runs from the caret to there. */
async function selectTo(text) {
  await browser.execute((needle) => {
    const editor = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
    const line = [...editor.querySelectorAll(".cm-line")].find((l) =>
      l.textContent.includes(needle),
    );
    // On screen first, clear of the sticky video and the bottom bar.
    let scroller = line.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    // Somewhere the click lands on the line itself: not under a sticky video
    // at the top or the bottom bar.
    const hits = () => {
      const r = line.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 40, r.top + r.height / 2);
      return !!hit && line.contains(hit);
    };
    for (const ratio of [0.75, 0.5, 0.6, 0.4]) {
      if (!scroller) break;
      const lineTop = line.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTop += lineTop - scroller.clientHeight * ratio;
      if (hits()) break;
    }
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + needle.length - 1);
      range.setEnd(node, at + needle.length);
      const box = range.getBoundingClientRect();
      const point = {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
        shiftKey: true,
        clientX: box.right - 1,
        clientY: box.top + box.height / 2,
      };
      const target = document.elementFromPoint(point.clientX, point.clientY) ?? line;
      target.dispatchEvent(new MouseEvent("mousedown", point));
      target.dispatchEvent(new MouseEvent("mouseup", point));
      return;
    }
  }, text);
  await browser.pause(150);
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

/** Type into the pen's box, as the keyboard would. */
async function typeInBox(text) {
  await waitForBox();
  await browser.execute((value) => {
    const input = document.querySelector(".cm-pen-pop .pen-box-input");
    input.focus();
    // React reads a controlled input's value through the native setter.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

/** The pen's box is loaded on first use: wait for its field. */
async function waitForBox() {
  await browser.waitUntil(
    () => browser.execute(() => !!document.querySelector(".cm-pen-pop .pen-box-input")),
    { timeout: 5_000, timeoutMsg: "the pen's box didn't open" },
  );
}

/** Click a pill in the open box, as the mouse does (it only selects it). */
async function clickPill(label) {
  await waitForBox();
  await browser.execute((name) => {
    [...document.querySelectorAll('.cm-pen-pop [role="toolbar"] button')]
      .find((b) => b.textContent.includes(name))
      .click();
  }, label);
  await browser.pause(100);
}

/** In the open box: a function's key turns it on, Enter runs it. */
async function pick(name, options) {
  await waitForBox();
  await key(name, options);
  await key("Enter");
}

const pop = () =>
  browser.execute(() => {
    const box = document.querySelector(".cm-pen-pop");
    if (!box) return null;
    return {
      pills: [...box.querySelectorAll('[role="toolbar"] button')].map((b) => b.textContent),
      selected: [...box.querySelectorAll('[role="toolbar"] button[aria-pressed="true"]')].map(
        (b) => b.textContent,
      ),
      typed: box.querySelector(".pen-box-input")?.value ?? null,
      bottom: box.getBoundingClientRect().bottom,
      focused: document.activeElement?.classList.contains("pen-box-input") ?? false,
    };
  });

/** Where the open box is, against the part of the page you can see (the
 *  editor's scroller, inside the window) and the caret. */
const boxOnScreen = () =>
  browser.execute(() => {
    const box = document.querySelector(".cm-pen-pop .pen-box")?.getBoundingClientRect();
    const editor = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
    let scroller = editor?.parentElement ?? null;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    const band = scroller.getBoundingClientRect();
    const top = Math.max(band.top, 0);
    const bottom = Math.min(band.bottom, window.innerHeight);
    const caret = document.querySelector(".cm-cursor")?.getBoundingClientRect().top ?? null;
    return {
      inside: !!box && box.height > 0 && box.top >= top && box.bottom <= bottom,
      box: box && { top: box.top, bottom: box.bottom },
      band: { top, bottom },
      caret,
    };
  });

/** The open box settles where you can see it (the page may still be
 *  scrolling to the selection when it opens). The hidden e2e window runs no
 *  frames, so CodeMirror never measures the box again by itself: a 1px
 *  scroll each poll stands in for them (qa-checklist harness notes). */
async function waitForBoxOnScreen() {
  let seen = null;
  let step = 1;
  await browser
    .waitUntil(
      async () => {
        await browser.execute((by) => {
          const editor = [...document.querySelectorAll(".cm-content")].find(
            (el) => el.offsetParent,
          );
          let scroller = editor.parentElement;
          while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
            scroller = scroller.parentElement;
          }
          scroller.scrollTop += by;
        }, step);
        step = -step;
        await browser.pause(150);
        seen = await boxOnScreen();
        return seen.inside;
      },
      { timeout: 4_000, interval: 100 },
    )
    .catch(() => {
      throw new Error(`the box is out of sight: ${JSON.stringify(seen)}`);
    });
}

const barText = () =>
  browser.execute(() => {
    const bars = [...document.querySelectorAll(".pen-hint")].filter((el) => el.offsetParent);
    return bars.map((el) => el.textContent).join(" | ");
  });

const penLines = () =>
  browser.execute(() => {
    const editor = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
    return [...editor.querySelectorAll(".cm-line.cm-pen-line")].map((l) => ({
      text: l.textContent,
      kind: [...l.classList].find((c) => /^cm-pen-[srvpneqahcfm]$/.test(c))?.slice(-1) ?? null,
    }));
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

describe("Journeys: second pen", function () {
  // The pen's journeys wait on Claude, a few seconds per line.
  this.timeout(150_000);
  let root;

  before(async function () {
    root = await workspaceRoot();
  });

  // A journey that fails with the box open must not break the next one.
  afterEach(async function () {
    await browser.execute(() => {
      const input = document.querySelector(".cm-pen-pop .pen-box-input");
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
  });

  it("PEN-02 ⌘. opens the pen's box above the line: pills and a box to type in; Esc closes it", async function () {
    await openViaPalette("Pen");
    await caretAfter("I think we basically");
    // The top of the words themselves (a line box is taller than its text).
    const lineTop = await browser.execute(() => {
      const editor = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
      const line = [...editor.querySelectorAll(".cm-line")].find((l) =>
        l.textContent.includes("I think we basically"),
      );
      const node = document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      return range.getBoundingClientRect().top;
    });
    await key(".", { meta: true });
    await waitForBox();
    // After its 150ms entrance, which starts it a few pixels low.
    await browser.pause(300);
    const box = await pop();
    for (const label of ["Answer", "Check", "Connect"]) {
      ok(
        box.pills.some((p) => p.includes(label)),
        `no ${label} pill: ${JSON.stringify(box.pills)}`,
      );
    }
    for (const gone of ["Ask me", "Facts", "Mix", "Shorten"]) {
      ok(!box.pills.some((p) => p.includes(gone)), `${gone} should be gone: ${box.pills}`);
    }
    ok(box.focused, "the box to type in should have the keyboard");
    ok(box.bottom <= lineTop + 2, `the box should sit above the line (${box.bottom} > ${lineTop})`);
    await key("Escape");
    await browser.waitUntil(async () => (await pop()) === null, {
      timeout: 3_000,
      timeoutMsg: "Esc didn't close the box",
    });
  });

  it("PEN-03 Enter on an empty take keeps the answer sealed", async function () {
    const path = `${root}/Notes/Pen.md`;
    const before = await readFile(path);
    await caretInWaiting("Your take");
    await key("Enter");
    await browser.waitUntil(async () => (await barText()).includes("wrong guess counts"), {
      timeout: 3_000,
      timeoutMsg: `the bar should ask for a take first: ${await barText()}`,
    });
    ok((await readFile(path)) === before, "nothing should open or be written");
    ok(
      await browser.execute(() => document.querySelectorAll(".cm-pen-sealed").length > 0),
      "the answer should be drawn sealed",
    );
  });

  it("PEN-12 ⌥↵ on the empty take opens the answer without a comparison", async function () {
    const path = `${root}/Notes/Pen.md`;
    await key("Enter", { alt: true });
    const text = await waitForDisk(
      path,
      (t) => t.includes("older ones. ^ai-r-aaaa") && !t.includes("^ai-s-aaaa"),
      "expected the answer opened (^ai-r-…)",
    );
    ok(!/\^ai-r-aaaa\n {4}- \n/.test(text), `the empty take should be gone:\n${text}`);
  });

  it("PEN-04 Enter on one of several echoes opens a line under it and keeps them all", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretAfter("forgot their names.");
    await key("Enter");
    const text = await waitForDisk(
      path,
      (t) => /\^ai-e-cccc\n {4}- /.test(t),
      "expected an empty line under the echo",
    );
    ok(text.includes("^ai-e-bbbb"), `the other echo should stay:\n${text}`);
    ok(
      !(await barText()).includes("keep it"),
      `the bar shouldn't offer to keep it: ${await barText()}`,
    );
  });

  it("PEN-01 ★ ⌘. ! writes a sealed answer under the line, your take beside it", async function () {
    const path = `${root}/Notes/Pen.md`;
    await openViaPalette("Pen");
    await armOn("why does sleep help memory?");
    await pick("!", { shift: true });
    await waitForDisk(
      path,
      (t) => /help memory\?\n {2}- .+ \^ai-s-[a-z0-9]{4}\n {2}- \n/.test(t),
      "expected a sealed answer (^ai-s-…) with an empty take right beside it, at its level",
      AI_TIMEOUT,
    );
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          [...document.querySelectorAll(".cm-pen-waiting")].some((w) =>
            w.textContent.includes("Your take"),
          ),
        ),
      { timeout: 3_000, timeoutMsg: "the empty take should say what goes there" },
    );
    const lines = await penLines();
    ok(
      lines.some((l) => l.kind === "s"),
      `the answer isn't drawn as a sealed pen line: ${JSON.stringify(lines)}`,
    );
  });

  it("PEN-10 a take that isn't one keeps the answer sealed", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretInWaiting("Your take");
    await typeInEditor("sad lion sits there", { atEnd: false });
    await waitForDisk(path, (t) => t.includes("- sad lion sits there"), "the take should be typed");
    await key("Enter");
    let said = "";
    await browser
      .waitUntil(
        async () => {
          said = await barText();
          return said.includes("doesn't read as a take");
        },
        { timeout: AI_TIMEOUT },
      )
      .catch(async () => {
        throw new Error(
          `expected the take to be turned down; the bar said: ${said}\n${await readFile(path)}`,
        );
      });
    const text = await readFile(path);
    ok(/help memory\?\n {2}- .+ \^ai-s-/.test(text), `the answer should stay sealed:\n${text}`);
  });

  // The answer PEN-06 opened: Undo (PEN-26) must bring this very line back.
  let opened = "";

  it("PEN-06 a real take opens the answer and nothing else moves; Combine waits under your take", async function () {
    const path = `${root}/Notes/Pen.md`;
    // Take the nonsense back, key by key, and write a real take.
    await caretAfter("sad lion sits there");
    for (let k = 0; k < "sad lion sits there".length; k++) await key("Backspace");
    await typeInEditor("I guess the brain replays what you learned while you sleep", {
      atEnd: false,
    });
    await waitForDisk(
      path,
      (t) => t.includes("replays what you learned"),
      "the take should be typed",
    );
    await key("Enter");
    const text = await waitForDisk(
      path,
      (t) => /help memory\?\n {2}- .+ \^ai-r-[a-z0-9]{4}\n {2}- I guess.+\n {2}- \n/.test(t),
      "expected the answer opened (^ai-r-…), your take beside it and an empty line under that",
      AI_TIMEOUT,
    );
    ok(!/help memory\?\n {2}- .+ \^ai-s-/.test(text), text);
    ok(
      !/\^ai-v-/.test(text.split("help memory?")[1].split("- naps")[0]),
      `no comparison:\n${text}`,
    );
    opened = /help memory\?\n( {2}- .+ \^ai-r-[a-z0-9]{4})\n/.exec(text)[1];
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          [...document.querySelectorAll(".cm-pen-waiting")].some(
            (w) =>
              w.textContent.includes("Put the two together") &&
              w.querySelector(".cm-pen-waiting-act")?.textContent.includes("Combine"),
          ),
        ),
      { timeout: 3_000, timeoutMsg: "the empty line should offer Combine right after its words" },
    );
  });

  /** The lines under "why does sleep help memory?", up to the next question. */
  const underSleep = (text) => text.split("help memory?\n")[1].split("\n- ")[0].split("\n");

  it("PEN-25 Tab under your take combines the two into one list of points", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretInWaiting("Put the two together");
    await key("Tab");
    const text = await waitForDisk(
      path,
      (t) => !t.includes(opened) && /help memory\?\n(?: {2,6}- .+\n)+ {2}- \n/.test(t),
      "expected the answer and your take replaced by one list, an empty line last",
      AI_TIMEOUT,
    );
    const lines = underSleep(text);
    const mine = lines.filter((l) => l.trim() && !/\^ai-/.test(l) && l.trim() !== "-");
    const pens = lines.filter((l) => /\^ai-r-[a-z0-9]{4}$/.test(l));
    ok(pens.length >= 1, `expected the pen's points (^ai-r-…):\n${text}`);
    ok(mine.length >= 1, `expected your points:\n${text}`);
    const take = "I guess the brain replays what you learned while you sleep".toLowerCase();
    for (const line of mine) {
      ok(take.includes(line.replace(/^\s*- /, "").toLowerCase()), `not your words: ${line}`);
    }
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          [...document.querySelectorAll(".cm-pen-waiting")].some(
            (w) =>
              w.textContent.includes("Add a point") &&
              w.querySelector(".cm-pen-waiting-act")?.textContent.includes("Undo"),
          ),
        ),
      { timeout: 3_000, timeoutMsg: "the empty line should say what it's for, with Undo after it" },
    );
  });

  it("PEN-26 Undo puts the answer and your take back as they were", async function () {
    const path = `${root}/Notes/Pen.md`;
    await browser.execute(() =>
      [...document.querySelectorAll(".cm-pen-waiting-act")]
        .find((b) => b.textContent.includes("Undo"))
        .click(),
    );
    await waitForDisk(
      path,
      (t) =>
        t.includes(
          `${opened}\n  - I guess the brain replays what you learned while you sleep\n  - \n`,
        ),
      "expected the opened answer, your take and the empty line back",
    );
  });

  it("PEN-27 after Combine, the empty line goes once you click another line", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretInWaiting("Put the two together");
    await key("Tab");
    await waitForDisk(
      path,
      (t) => !t.includes(opened) && /help memory\?\n(?: {2,6}- .+\n)+ {2}- \n/.test(t),
      "expected the two combined, an empty line last",
      AI_TIMEOUT,
    );
    await caretAfter("naps help you remember");
    const text = await waitForDisk(
      path,
      (t) => /help memory\?\n(?: {2,6}- .+\n)+- why do drafts/.test(t),
      "expected the empty line under the list gone",
    );
    ok(!underSleep(text).some((l) => l.trim() === "-"), text);
  });

  it("PEN-11 ⌘. ! on a plain line writes a plain sealed line right below it", async function () {
    const path = `${root}/Notes/Pen.md`;
    await armOn("Writing is thinking on paper.");
    await pick("!", { shift: true });
    await waitForDisk(
      path,
      (t) => /^Writing is thinking on paper\.\n\n[^\s-].+ \^ai-s-[a-z0-9]{4}\n- \n/.test(t),
      "expected a plain sealed line (no bullet) below the paragraph, your take under it",
      AI_TIMEOUT,
    );
  });

  it("PEN-14 typing a question in the box and Enter: your question, the sealed answer under it", async function () {
    const path = `${root}/Notes/Pen.md`;
    await armOn("rereading feels like learning");
    await typeInBox("what's the opposite of rereading?");
    await key("Enter");
    await waitForDisk(
      path,
      (t) => /\n {2}- what's the opposite of rereading\?\n {4}- .+ \^ai-s-[a-z0-9]{4}/.test(t),
      "expected your question as a sub-bullet and the sealed answer under it",
      AI_TIMEOUT,
    );
  });

  it("PEN-18 a pill's key in the box selects that pill and types nothing; Backspace unselects it", async function () {
    await armOn("I think we basically");
    await waitForBox();
    const keys = (await pop()).pills;
    ok(
      keys.some((p) => p.includes("@") && p.includes("Check")),
      `pills should show their keys: ${JSON.stringify(keys)}`,
    );
    await key("@", { shift: true });
    await browser.waitUntil(async () => (await pop())?.selected.some((p) => p.includes("Check")), {
      timeout: 3_000,
      timeoutMsg: "@ didn't select the Check pill",
    });
    ok((await pop()).typed === "", "the key shouldn't be typed into the box");
    // A Chinese input method's full-width ［ picks Connect the same way.
    await key("［");
    await browser.waitUntil(
      async () => (await pop())?.selected.some((p) => p.includes("Connect")),
      { timeout: 3_000, timeoutMsg: "［ didn't select Connect" },
    );
    ok((await pop()).typed === "", "［ shouldn't be typed into the box");
    await key("Backspace");
    await browser.waitUntil(async () => (await pop())?.selected.length === 0, {
      timeout: 3_000,
      timeoutMsg: "Backspace didn't unselect Connect",
    });
    await key("Escape");
  });

  it("PEN-19 clicking a pill only selects it; Enter runs it (Check: both sides)", async function () {
    const path = `${root}/Notes/Pen.md`;
    const before = await readFile(path);
    await armOn("naps help you remember");
    await waitForBox();
    await clickPill("Check");
    await browser.pause(1_500);
    ok((await readFile(path)) === before, "a click alone shouldn't run the pen");
    ok(
      (await pop())?.selected.some((p) => p.includes("Check")),
      "the clicked pill should be selected",
    );
    await key("Enter");
    // PEN-07: on a claim, For, Against, and your call waiting under Against.
    const text = await waitForDisk(
      path,
      (t) =>
        /what you studied\n {2}- For: .+ \^ai-p-[a-z0-9]{4}\n {2}- Against: .+ \^ai-n-[a-z0-9]{4}\n {4}- \n/.test(
          t,
        ),
      "expected For (^ai-p-…), Against (^ai-n-…) and an empty line under Against",
      AI_TIMEOUT,
    );
    ok(/\]\(https?:\/\/[^\s)]+ "[^"]+"\) \^ai-[pn]-/.test(text), `expected a paper:\n${text}`);
    await browser.waitUntil(
      () => browser.execute(() => document.querySelectorAll(".cm-pen-cite").length > 0),
      { timeout: 3_000, timeoutMsg: "the citation isn't drawn as a pill" },
    );
  });

  it("PEN-24 Esc on your empty call takes both sides back", async function () {
    const path = `${root}/Notes/Pen.md`;
    await key("Escape");
    await waitForDisk(
      path,
      (t) => !t.includes("^ai-p-") && !t.includes("^ai-n-"),
      "expected For and Against to be gone",
    );
  });

  it("PEN-23 ⌘. @ on a how-to line labels for what it asks, not For and Against", async function () {
    const path = `${root}/Notes/Pen.md`;
    await armOn("how to make a new habit stick");
    await pick("@", { shift: true });
    const text = await waitForDisk(
      path,
      (t) => /habit stick\n {2}- [^:\n]+: .+ \^ai-p-[a-z0-9]{4}\n {2}- [^:\n]+: .+ \^ai-n-/.test(t),
      "expected two labelled lines (^ai-p-…, ^ai-n-…) under the how-to line",
      AI_TIMEOUT,
    );
    const labels = [...text.matchAll(/^ {2}- ([^:\n]+): .+ \^ai-[pn]-/gm)].map((m) => m[1]);
    ok(
      !labels.includes("For") && !labels.includes("Against"),
      `a how-to takes no side, so no For / Against: ${labels.join(", ")}`,
    );
    await key("Escape");
    await waitForDisk(
      path,
      (t) => !t.includes("^ai-p-") && !t.includes("^ai-n-"),
      "expected Esc to take both lines back",
    );
  });

  it("PEN-15 ⌘. [ on a line brings back what you wrote in another note", async function () {
    const path = `${root}/Notes/Pen.md`;
    await armOn("naps help you remember");
    await pick("［");
    await waitForDisk(
      path,
      (t) =>
        /\n {2}- (Supports|Contradicts|Example|Definition|Summary|Answer|Another angle): .+ — \[\[Sleep log\]\] \^ai-e-[a-z0-9]{4}/.test(
          t,
        ),
      "expected an echo of Sleep log (^ai-e-…)",
      AI_TIMEOUT,
    );
    // Short: a point, not the whole line; the link keeps the original.
    const echoes = (await readFile(path)).split("\n").filter((l) => /\^ai-e-/.test(l));
    for (const line of echoes) {
      const point = line.replace(/^\s*- [A-Z][a-z]+( angle)?: /, "").split(" — [[")[0];
      ok(point.split(/\s+/).length <= 33, `an echo should be short: ${line}`);
    }
    // One ink: the link inside an echo is the colour of the echo's words.
    const colours = await browser.execute(() => {
      const line = [...document.querySelectorAll(".cm-line.cm-pen-e")].find((l) =>
        l.textContent.includes("Sleep log"),
      );
      const link = line?.querySelector(".cm-wiki-link, .cm-wiki-link-editing");
      return line && link
        ? { line: getComputedStyle(line).color, link: getComputedStyle(link).color }
        : null;
    });
    ok(colours, "the echo's link should be drawn");
    ok(colours.link === colours.line, `link ${colours.link} vs line ${colours.line}`);
    // The label reads first: bold, the point after it not.
    const label = await browser.execute(() => {
      const line = [...document.querySelectorAll(".cm-line.cm-pen-e")].find((l) =>
        l.textContent.includes("Sleep log"),
      );
      const mark = line?.querySelector(".cm-pen-label");
      return mark
        ? { text: mark.textContent, weight: Number(getComputedStyle(mark).fontWeight) }
        : null;
    });
    ok(label, "the echo's label should be marked");
    ok(/^[A-Z][a-z]+( angle)?:$/.test(label.text), `label text: ${label.text}`);
    ok(label.weight >= 600, `label weight ${label.weight}`);
  });

  it("PEN-05 Esc right after the echoes land takes them back", async function () {
    const path = `${root}/Notes/Pen.md`;
    await key("Escape");
    await waitForDisk(
      path,
      (t) => !t.includes("[[Sleep log]]"),
      "expected the new echoes to be gone",
    );
    const text = await readFile(path);
    ok(text.includes("^ai-e-bbbb") && text.includes("^ai-e-cccc"), `earlier echoes stay:\n${text}`);
  });

  it("PEN-16 Organize on several lines, then Esc puts your lines back exactly", async function () {
    await openViaPalette("Pen");
    const path = `${root}/Notes/Pen.md`;
    const before = await readFile(path);
    await caretAfter("sleep on it");
    await selectTo("why does sleep help memory?");
    await key(".", { meta: true });
    await waitForBox();
    await pick("#", { shift: true });
    const started = Date.now();
    await browser.waitUntil(
      () => browser.execute(() => document.querySelectorAll(".cm-pen-organized").length > 0),
      // Organize asks Sonnet, and once more when the reply is flat or mixed.
      { timeout: AI_TIMEOUT * 2, timeoutMsg: `no organized outline: ${await barText()}` },
    );
    await key("Escape");
    await waitForDisk(path, (t) => t === before, "Esc should put the lines back exactly");
  });

  it("PEN-17 Organize, then Enter keeps it: topics of labelled points, your words under the ones they back", async function () {
    await openViaPalette("Pen");
    const path = `${root}/Notes/Pen.md`;
    await caretAfter("sleep on it");
    await selectTo("why does sleep help memory?");
    await key(".", { meta: true });
    await pick("#", { shift: true });
    const started = Date.now();
    await browser.waitUntil(
      () => browser.execute(() => document.querySelectorAll(".cm-pen-organized").length > 0),
      // Organize asks Sonnet, and once more when the reply is flat or mixed.
      { timeout: AI_TIMEOUT * 2, timeoutMsg: `no organized outline: ${await barText()}` },
    );
    // Under the outline, where the pen wrote it.
    const said = await browser.execute(
      () => document.querySelector(".cm-pen-pending-text")?.textContent ?? "",
    );
    ok(
      /\d+ topics?\. Your words sit under the points they back\./.test(said),
      `under the outline: ${said}`,
    );
    // And in the bottom bar, where it can't scroll out of sight.
    const bar = await barText();
    ok(bar.includes(said) && bar.includes("put mine back"), `in the bar: ${bar}`);
    await key("Enter");
    const text = await waitForDisk(
      path,
      // Your words stay as you wrote them, under the pen's labelled points.
      (t) =>
        t.includes("why does sleep help memory?") &&
        t.includes("sleep on it") &&
        /^\s*- \*\*[^*\n]+:\*\* \S.* \^ai-g-[a-z0-9]{4}$/m.test(t),
      "the outline should have a labelled point and keep your own words",
    );
    ok(!(await browser.execute(() => document.querySelectorAll(".cm-pen-organized").length)), text);
  });

  it("PEN-33 ⌘. on lines selected up from the bottom of a long note: the box opens where you see it", async function () {
    await openViaPalette("Long essay");
    await browser.pause(1_500);
    await caretAfter("Paragraph 2 keeps");
    // Shift-Page Down: the selection runs on down the note, and the page
    // follows its end, so where it starts goes out of sight above.
    for (let page = 0; page < 4; page++) await key("PageDown", { shift: true });
    await browser.pause(200);
    await key(".", { meta: true });
    await waitForBox();
    await browser.pause(300);
    await waitForBoxOnScreen();
    await key("Escape");
  });

  it("PEN-22 # Organize is offered for one line too, and picking it keeps the box's width", async function () {
    await openViaPalette("Pen");
    await armOn("naps help you remember");
    await waitForBox();
    ok(
      (await pop()).pills.some((p) => p.includes("Organize")),
      "one line: Organize",
    );
    const before = await browser.execute(
      () => document.querySelector(".pen-box")?.getBoundingClientRect().width ?? 0,
    );
    // Picked, not run: no wider than its pills, and the placeholder and key hint fit uncut.
    await key("#", { shift: true });
    const fit = await browser.execute(() => {
      const box = document.querySelector(".pen-box");
      const input = document.querySelector(".pen-box-input");
      const ctx = document.createElement("canvas").getContext("2d");
      const style = getComputedStyle(input);
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      return {
        mode: box?.dataset.mode ?? null,
        width: box?.getBoundingClientRect().width ?? 0,
        need: ctx.measureText(input.placeholder).width,
        room: input.clientWidth - pad,
        placeholder: input.placeholder,
      };
    });
    ok(fit.mode === "#", `Organize picked: ${JSON.stringify(fit)}`);
    ok(fit.need <= fit.room, `placeholder cut: ${JSON.stringify(fit)}`);
    ok(Math.abs(fit.width - before) < 1, `box widened from ${before}: ${JSON.stringify(fit)}`);
    await key("Escape");
    // A line Organize (PEN-17) leaves as it was.
    await caretAfter("drafts get better overnight");
    await selectTo("naps help you remember");
    await key(".", { meta: true });
    await waitForBox();
    ok(
      (await pop()).pills.some((p) => p.includes("Organize")),
      "several lines: Organize",
    );
    await key("Escape");
  });

  it("PEN-13 in a video note, ⌘. ! answers from the transcript with its time, sealed", async function () {
    const path = `${root}/Library/How we remember.md`;
    await openViaPalette("How we remember");
    await armOn("what did the 2006 study compare?");
    await pick("!", { shift: true });
    await waitForDisk(
      path,
      (t) => /2006 study compare\?\n {2}- .+ — 1:10 \^ai-s-[a-z0-9]{4}/.test(t),
      "expected a sealed answer ending with the transcript's time (— 1:10)",
      AI_TIMEOUT,
    );
  });

  it("PEN-30 Organize turns a list into topics of labelled points, your lines untouched under them", async function () {
    const path = `${root}/Notes/Side projects.md`;
    const before = await readFile(path);
    await openViaPalette("Side projects");
    await caretAfter("too many things at once");
    await selectTo("the CLI I shipped in a weekend");
    await key(".", { meta: true });
    await waitForBox();
    await pick("#", { shift: true });
    await browser.waitUntil(
      () => browser.execute(() => document.querySelectorAll(".cm-pen-organized").length > 0),
      { timeout: AI_TIMEOUT * 2, timeoutMsg: `no organized outline: ${await barText()}` },
    );
    await key("Enter");
    const text = await waitForDisk(path, (t) => t !== before, "expected an outline");
    console.log(`DEBUG PEN-30\n${text}`);
    const lines = text.split("\n");
    // Each topic a heading, its first line a point of the pen's: a bold
    // label, then what the topic comes to, in its ink.
    const topics = lines.flatMap((l, k) => (/^#{2,6} \S/.test(l) ? [k] : []));
    ok(topics.length >= 1, `no topic heading:\n${text}`);
    const point = /^\s*- \*\*([^*]+):\*\*( \S.*)? \^ai-g-[a-z0-9]{4}$/;
    for (const k of topics) {
      const gist = lines[k + 1] ?? "";
      ok(/^- \*\*[^*]+:\*\* \S/.test(gist) && point.test(gist), `no first point:\n${text}`);
      // What it comes to is one claim, not your story back: two sentences at most.
      const said = gist.replace(/ \^ai-g-[a-z0-9]{4}$/, "").replace(/^- \*\*[^*]+:\*\* /, "");
      ok(said.split(/(?<=[.!?])\s+/).filter(Boolean).length <= 2, `too long: "${gist}"\n${text}`);
    }
    // Every line of the pen's is led by its label; no fixed Evidence section.
    const pens = lines.filter((l) => / \^ai-g-[a-z0-9]{4}$/.test(l));
    for (const l of pens) ok(point.test(l), `a pen line without a label: "${l}"\n${text}`);
    ok(!/\*\*Evidence:\*\*/.test(text), `the old Evidence section:\n${text}`);
    const label = point.exec(lines[topics[0] + 1])[1];
    // Your words untouched: every line you selected is there, as you wrote it.
    const yours = before
      .split("\n")
      .map((l) => l.replace(/^- /, ""))
      .filter(Boolean);
    for (const mine of yours) ok(text.includes(mine), `lost or rewritten: "${mine}"\n${text}`);
    // On screen the key is bold, its ** markers out of sight.
    const bold = await browser.execute((label) => {
      const editor = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
      const line = [...(editor?.querySelectorAll(".cm-line") ?? [])].find((l) =>
        // The bullet's "- " sits in its own prefix span, still in textContent.
        (l.textContent ?? "").replace(/^-?\s*/, "").startsWith(`${label}: `),
      );
      if (!line) return null;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.data.includes(label)) continue;
        const key = getComputedStyle(node.parentElement);
        return {
          weight: Number(key.fontWeight),
          color: key.color,
          ink: getComputedStyle(line).color,
        };
      }
      return null;
    }, label);
    ok(bold && bold.weight >= 600, `the key phrase isn't bold on screen (${JSON.stringify(bold)})`);
    // Bold, but the pen's ink like the rest of its line: never your black.
    ok(bold.color === bold.ink, `key ${bold.color} vs the line's ink ${bold.ink}`);
  });

  it("PEN-31 Organize keeps every level you wrote: blueberry, its benefit, its types", async function () {
    const path = `${root}/Notes/Fruit.md`;
    const before = await readFile(path);
    await openViaPalette("Fruit");
    await caretAfter("fruit");
    await selectTo("Biomechnical functionalities");
    await key(".", { meta: true });
    await waitForBox();
    await pick("#", { shift: true });
    await browser.waitUntil(
      () => browser.execute(() => document.querySelectorAll(".cm-pen-organized").length > 0),
      { timeout: AI_TIMEOUT, timeoutMsg: `no organized outline: ${await barText()}` },
    );
    await key("Enter");
    const text = await waitForDisk(path, (t) => t !== before, "expected an outline");
    const lines = text.split("\n");
    const indent = (l) => /^ */.exec(l)[0].length;
    // Your lines only: a topic's heading and the pen's own lines (its
    // ink, `^ai-g-…`) may use the same words.
    ok(/ \^ai-g-[a-z0-9]{4}$/m.test(text), `no point of the pen's:\n${text}`);
    const yours = (l) => !l.startsWith("#") && !/ \^ai-g-[a-z0-9]{4}$/.test(l);
    const at = (re) => {
      const k = lines.findIndex((l) => yours(l) && re.test(l));
      ok(k >= 0, `${re} is gone:\n${text}`);
      return k;
    };
    // Each one under the one before it, a level deeper.
    const chain = [/blueberr/i, /benefit/i, /types/i, /biomech/i].map(at);
    chain
      .slice(1)
      .forEach((k, n) =>
        ok(
          k > chain[n] && indent(lines[k]) > indent(lines[chain[n]]),
          `${lines[k].trim()} should sit under ${lines[chain[n]].trim()}:\n${text}`,
        ),
      );
    ok(indent(lines[chain[0]]) > 0, `blueberry should sit under fruit:\n${text}`);
  });
});
