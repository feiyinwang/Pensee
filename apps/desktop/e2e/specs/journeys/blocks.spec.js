// Block journeys (BLK-01, BLK-05 in docs/qa/user-journeys.md): the grip's handle menu.
// Runs on the seeded QA vault (e2e/qa/seed-vault.mjs).
import { strictEqual } from "node:assert/strict";
import { invoke, typeInEditor, waitForTitle, workspaceRoot } from "./_helpers.js";

/** Click just before `text` (or just after it, with `end`), with Shift held
 *  to extend the selection: how a hand selects, since CodeMirror ignores a
 *  scripted DOM selection in the unfocused e2e window. */
const clickText = (text, { end = false, shift = false } = {}) =>
  browser.execute(
    (needle, atEnd, withShift) => {
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
        const char = atEnd ? at + needle.length - 1 : at;
        const range = document.createRange();
        range.setStart(node, char);
        range.setEnd(node, char + 1);
        const box = range.getBoundingClientRect();
        const point = {
          bubbles: true,
          cancelable: true,
          button: 0,
          detail: 1,
          shiftKey: withShift,
          clientX: atEnd ? box.right - 1 : box.left + 1,
          clientY: box.top + box.height / 2,
        };
        const target = document.elementFromPoint(point.clientX, point.clientY) ?? line;
        target.dispatchEvent(new MouseEvent("mousedown", point));
        target.dispatchEvent(new MouseEvent("mouseup", point));
        target.dispatchEvent(new MouseEvent("click", point));
        return;
      }
      throw new Error(`"${needle}" is split across nodes`);
    },
    text,
    end,
    shift,
  );

/** The selected text in the front editor, read from CodeMirror's state. */
const selectedText = () =>
  browser.execute(() => {
    const content = [...document.querySelectorAll(".cm-content")].find((el) => el.offsetParent);
    const view = content?.cmTile?.root?.view;
    if (!view) throw new Error("no EditorView behind .cm-content");
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  });

/** Point at the list line holding `text` until the grip parks beside it, then
 *  rest on the grip so its panel opens (`mouseenter` does not bubble, so it
 *  goes to the grip itself; the panel waits MENU_OPEN_DELAY). */
async function openHandleMenu(text) {
  await browser.execute((needle) => {
    const line = [...document.querySelectorAll(".cm-line")].find(
      (el) => el.offsetParent && el.textContent.includes(needle),
    );
    if (!line) throw new Error(`no line with ${needle}`);
    const r = line.getBoundingClientRect();
    line.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: r.left + 40,
        clientY: r.top + r.height / 2,
      }),
    );
  }, text);
  await $(".wr-gutter-grab.wr-gutter-on").waitForExist({ timeout: 5_000 });
  await browser.execute(() => {
    const grip = document.querySelector(".wr-gutter-grab");
    const r = grip.getBoundingClientRect();
    grip.dispatchEvent(
      new MouseEvent("mouseenter", {
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }),
    );
  });
  await $(".wr-bmenu-tile").waitForExist({
    timeout: 5_000,
    timeoutMsg: "the handle menu never opened",
  });
}

/** Open Welcome from the sidebar's Search field, which opens the palette
 *  whichever key it is bound to. */
async function openWelcome() {
  await $("[data-sidebar-surface-content] [data-sidebar-search-button]").click();
  const input = await $("[cmdk-input]");
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue("Welcome");
  const item = await $('//*[@cmdk-item][contains(., "Welcome")]');
  await item.waitForExist({ timeout: 5_000 });
  await item.click();
  await waitForTitle("Welcome");
}

/** Welcome.md on disk once it contains `needle`. */
async function welcomeOnDisk(root, needle) {
  let content = "";
  await browser.waitUntil(
    async () => {
      const read = await invoke("read_file", { path: `${root}/Welcome.md` });
      content = typeof read.value === "string" ? read.value : (read.value?.content ?? "");
      return content.includes(needle);
    },
    { timeout: 8_000, timeoutMsg: `Welcome.md never got "${needle}"` },
  );
  return content;
}

describe("Journeys: blocks", function () {
  let root;
  before(async function () {
    root = await workspaceRoot();
  });

  it("BLK-01 hover a paragraph, choose Heading 2 from its handle: only that block becomes a heading", async function () {
    // Seeded: "A note to open first.", a blank line, "## Section", a list.
    await openWelcome();
    await openHandleMenu("A note to open first");
    await $('.wr-bmenu-tile[aria-label="Heading 2"]').click();
    const content = await welcomeOnDisk(root, "## A note to open first.");
    strictEqual(
      content.startsWith("## A note to open first.\n\n## Section\n\n- one\n- two\n"),
      true,
      `only the paragraph became a heading: ${JSON.stringify(content)}`,
    );
  });

  it("BLK-05 select several bullets, pick Numbered list from one grip: all of them are numbered", async function () {
    await openWelcome();

    // A list of its own, below the seeded one.
    await typeInEditor("\nIdeas\n\n- alpha\n- beta\n- gamma");
    await clickText("gamma", { end: true });
    await clickText("alpha", { shift: true });
    strictEqual(await selectedText(), "alpha\n- beta\n- gamma", "the three items are selected");

    await openHandleMenu("beta");
    await $('.wr-bmenu-tile[aria-label="Numbered list"]').click();

    const content = await welcomeOnDisk(root, "3. gamma");
    strictEqual(
      content.slice(content.indexOf("Ideas")).trimEnd(),
      "Ideas\n\n1. alpha\n2. beta\n3. gamma",
      "every selected item is numbered, in order",
    );
    // The seeded list above was not in the selection and keeps its bullets.
    strictEqual(
      content.includes("- one\n- two\n- [ ] a task"),
      true,
      "the other list is untouched",
    );
  });
});
