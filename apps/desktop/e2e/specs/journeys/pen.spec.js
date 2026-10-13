// The second pen (PEN in docs/qa/user-journeys.md, SPECs/second-pen-spec.md):
// ⌘. then one key in a note. The journeys that wait on Claude (PEN-01, -06,
// -07, -08) run the real pen, so they need Claude Code signed in on this Mac.
import { ok } from "node:assert/strict";
import { invoke, pressCmd, waitForTitle, workspaceRoot } from "./_helpers.js";

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
      if (scroller) {
        const lineTop = line.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTop += lineTop - scroller.clientHeight * 0.75;
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

/** A key pressed where the keyboard is: the pen's box when it's open, else
 *  the editor in front. */
async function key(name, { meta = false, shift = false } = {}) {
  await browser.execute(
    (k, metaKey, shiftKey) => {
      const editor = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
      const active = document.activeElement;
      const target = active?.closest?.(".cm-pen-pop") ? active : editor;
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: k,
          metaKey,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    name,
    meta,
    shift,
  );
  await browser.pause(80);
}

/** Type into the pen's box, as the keyboard would. */
async function typeInBox(text) {
  await browser.execute((value) => {
    const input = document.querySelector(".cm-pen-pop .cm-pen-input");
    if (!input) throw new Error("the pen's box isn't open");
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

const pop = () =>
  browser.execute(() => {
    const box = document.querySelector(".cm-pen-pop");
    if (!box) return null;
    return {
      pills: [...box.querySelectorAll(".cm-pen-pill")].map((b) => b.textContent),
      bottom: box.getBoundingClientRect().bottom,
      focused: document.activeElement?.classList.contains("cm-pen-input") ?? false,
    };
  });

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
      kind: [...l.classList].find((c) => /^cm-pen-[qahcfmr]$/.test(c))?.slice(-1) ?? null,
    }));
  });

async function waitForDisk(path, test, message, timeout = 8_000) {
  let last = "";
  try {
    await browser.waitUntil(
      async () => {
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
    throw new Error(`${message}\n--- file ---\n${last}\n--- bar ---\n${await barText()}`);
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

  it("PEN-02 ⌘. opens the pen's box above the line: pills and a box to type in; Esc closes it", async function () {
    await openViaPalette("Pen");
    await caretAfter("I think we basically");
    const lineTop = await browser.execute(() => {
      const editor = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
      const line = [...editor.querySelectorAll(".cm-line")].find((l) =>
        l.textContent.includes("I think we basically"),
      );
      return line.getBoundingClientRect().top;
    });
    await key(".", { meta: true });
    await browser.waitUntil(async () => (await pop()) !== null, {
      timeout: 3_000,
      timeoutMsg: "the pen's box didn't open",
    });
    const box = await pop();
    for (const label of ["Ask me", "Answer", "Facts", "Mix", "Shorten"]) {
      ok(
        box.pills.some((p) => p.includes(label)),
        `no ${label} pill: ${JSON.stringify(box.pills)}`,
      );
    }
    ok(box.focused, "the box to type in should have the keyboard");
    ok(box.bottom <= lineTop + 2, `the box should sit above the line (${box.bottom} > ${lineTop})`);
    await key("Escape");
    await browser.waitUntil(async () => (await pop()) === null, {
      timeout: 3_000,
      timeoutMsg: "Esc didn't close the box",
    });
  });

  it("PEN-03 Enter on a pen question opens an answer under it", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretAfter("What would you notice if it weren't?");
    await key("Enter");
    await waitForDisk(
      path,
      (text) => /\^ai-a-aaaa\n {4}- \n/.test(text),
      "expected an empty answer bullet under the question",
    );
  });

  it("PEN-05 Esc on that empty answer takes the question back", async function () {
    const path = `${root}/Notes/Pen.md`;
    await key("Escape");
    await waitForDisk(
      path,
      (text) => !text.includes("^ai-a-aaaa"),
      "expected the question to be gone",
    );
  });

  it("PEN-04 Enter on a mix keeps it and drops the unanswered one beside it", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretAfter("an open-book exam");
    await key("Enter");
    const text = await waitForDisk(
      path,
      (t) => !t.includes("^ai-m-bbbb") && t.includes("^ai-m-cccc"),
      "expected the other mix to go and this one to stay",
    );
    ok(/\^ai-m-cccc\n {4}- /.test(text), `expected an answer under the kept mix:\n${text}`);
  });

  it("PEN-01 ★ ⌘. ? on a line writes one pen question under it", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretAfter("I think we basically");
    await key(".", { meta: true });
    await key("?", { shift: true });
    const text = await waitForDisk(
      path,
      (t) => /sleep on it\n {2}- .+ \^ai-a-[a-z0-9]{4}/.test(t),
      "expected a question bullet (^ai-a-…) under the line",
      AI_TIMEOUT,
    );
    ok(text.split("^ai-a-").length === 2, `expected exactly one new question:\n${text}`);
    const lines = await penLines();
    ok(
      lines.some((l) => l.kind === "a"),
      `the question isn't drawn as a pen line: ${JSON.stringify(lines)}`,
    );
  });

  it("PEN-11 ⌘. ? on a plain line writes a plain line right below it", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretAfter("Writing is thinking on paper.");
    await key(".", { meta: true });
    await key("?", { shift: true });
    const text = await waitForDisk(
      path,
      (t) =>
        /^Writing is thinking on paper\.\n\n[^\s-].+ \^ai-a-[a-z0-9]{4}\n\n- rereading/.test(t),
      "expected a plain pen line (no bullet) right below the paragraph",
      AI_TIMEOUT,
    );
    ok(text.startsWith("Writing is thinking on paper."), text);
  });

  it("PEN-15 typed direction + Ask me: the question follows it, under the line", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretAfter("Writing is thinking on paper.");
    await key(".", { meta: true });
    await typeInBox("ask about first drafts");
    await browser.execute(() => {
      [...document.querySelectorAll(".cm-pen-pill")]
        .find((b) => b.textContent.includes("Ask me"))
        .click();
    });
    await waitForDisk(
      path,
      (t) => (t.split("\n\n- rereading")[0].match(/\^ai-a-/g) ?? []).length === 2,
      "expected a second plain pen question below the paragraph",
      AI_TIMEOUT,
    );
  });

  it("PEN-14 typing a question in the box and Enter: your question, the AI's answer under it", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretAfter("rereading feels like learning");
    await key(".", { meta: true });
    await typeInBox("what's the opposite of rereading?");
    await key("Enter");
    await waitForDisk(
      path,
      (t) => /\n {2}- what's the opposite of rereading\?\n {4}- .+ \^ai-r-[a-z0-9]{4}/.test(t),
      "expected your question as a sub-bullet and the answer under it",
      AI_TIMEOUT,
    );
  });

  it("PEN-08 ⌘. − proposes cuts; Enter applies them", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretAfter("I think we basically");
    await key(".", { meta: true });
    await key("-");
    await browser.waitUntil(
      () => browser.execute(() => document.querySelectorAll(".cm-pen-cut").length > 0),
      { timeout: AI_TIMEOUT, timeoutMsg: `no cuts shown: ${await barText()}` },
    );
    ok((await barText()).includes("words"), await barText());
    await key("Enter");
    const text = await waitForDisk(
      path,
      (t) => !t.includes("I think we basically just need to really sleep on it"),
      "expected the cuts applied",
    );
    ok(/sleep on it/.test(text), `the line lost its meaning:\n${text}`);
  });

  it("PEN-07 ⌘. @ adds one fact with a paper citation", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretAfter("rereading feels like learning");
    await key(".", { meta: true });
    await key("@", { shift: true });
    const text = await waitForDisk(
      path,
      (t) => /\[[^\]]+\]\(https?:\/\/[^\s)]+ "[^"]+"\) \^ai-f-[a-z0-9]{4}/.test(t),
      "expected a fact ending in a cited paper link (^ai-f-…)",
      AI_TIMEOUT,
    );
    ok(text.includes("^ai-f-"), text);
    await browser.waitUntil(
      () => browser.execute(() => document.querySelectorAll(".cm-pen-cite").length > 0),
      { timeout: 3_000, timeoutMsg: "the citation isn't drawn as a pill" },
    );
  });

  it("PEN-12 ⌘. ! answers your question right under it", async function () {
    const path = `${root}/Notes/Pen.md`;
    await caretAfter("why does sleep help memory?");
    await key(".", { meta: true });
    await key("!", { shift: true });
    await waitForDisk(
      path,
      (t) => /why does sleep help memory\?\n {2}- .+ \^ai-r-[a-z0-9]{4}/.test(t),
      "expected the pen's answer (^ai-r-…) as a sub-bullet of the question",
      AI_TIMEOUT,
    );
  });

  it("PEN-13 in a video note, ⌘. ! answers from the transcript with its time", async function () {
    const path = `${root}/Library/How we remember.md`;
    await openViaPalette("How we remember");
    await caretAfter("what did the 2006 study compare?");
    await key(".", { meta: true });
    await key("!", { shift: true });
    await waitForDisk(
      path,
      (t) => /2006 study compare\?\n {2}- .+ — 1:10 \^ai-r-[a-z0-9]{4}/.test(t),
      "expected an answer ending with the transcript's time (— 1:10)",
      AI_TIMEOUT,
    );
  });

  it("PEN-06 a quiz in a video note: question, I don't know, hint, then the check", async function () {
    const path = `${root}/Library/How we remember.md`;
    await openViaPalette("How we remember");
    await caretAfter("recall beats rereading after a week");
    await key(".", { meta: true });
    await key("?", { shift: true });
    await waitForDisk(
      path,
      (t) => /after a week\n {2}- .+ \^ai-q-[a-z0-9]{4}\n {4}- $/m.test(t),
      "expected a quiz question with an empty answer under it",
      AI_TIMEOUT,
    );
    // The caret is in the empty answer: Enter there is "I don't know".
    await key("Enter");
    await waitForDisk(
      path,
      (t) => / {4}- I don't know\n {6}- Hint: .+ \^ai-h-[a-z0-9]{4}\n {4}- $/m.test(t),
      "expected I don't know and a hint",
      AI_TIMEOUT,
    );
    await key("Enter");
    await waitForDisk(
      path,
      (t) => / {4}- I don't know\n {6}- .+ \^ai-c-[a-z0-9]{4}/.test(t),
      "expected the check, quoting the transcript",
      AI_TIMEOUT,
    );
  });
});
