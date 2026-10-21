// The smoke set (★ in docs/qa/user-journeys.md): the journeys every change
// must keep working, whatever it touches. Runs on the seeded QA vault
// (e2e/qa/seed-vault.mjs).
import { ok, strictEqual } from "node:assert/strict";
import {
  activeTitle,
  dayStamp,
  fileExists,
  fillField,
  frontTitleField,
  invoke,
  mouseClick,
  pressCmd,
  pressKey,
  typeInEditor,
  waitForFile,
  waitForTitle,
  workspaceRoot,
} from "./_helpers.js";

const editorText = () =>
  browser.execute(() => {
    const scope = document.querySelector("[data-column-tab][data-focused]") ?? document;
    const editors = [...scope.querySelectorAll(".cm-content")];
    const visible = editors.find((el) => el.offsetParent !== null);
    return visible ? visible.innerText : null;
  });

async function readFile(path) {
  const result = await invoke("read_file", { path });
  ok(result.ok, `read_file ${path} failed: ${result.error}`);
  return result.value.content;
}

/** Hover `selector` and read its chrome tooltip as "Label ⌘ P", then unhover.
 *  The WebDriver plugin sends no pointer events: dispatch the ones React listens for. */
async function hoverTooltip(selector) {
  const hover = (type) =>
    browser.execute(
      (selector, type) =>
        document
          .querySelector(selector)
          .dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse" })),
      selector,
      type,
    );
  await hover("pointerover");
  const tip = await $("[data-chrome-tooltip]");
  await tip.waitForExist({ timeout: 3_000 });
  const text = await browser.execute(() => {
    const bubble = document.querySelector("[data-chrome-tooltip]");
    const keys = [...bubble.querySelectorAll("kbd")].map((kbd) => kbd.textContent);
    return [bubble.firstChild.textContent, ...keys].join(" ");
  });
  await hover("pointerout");
  await tip.waitForExist({ timeout: 3_000, reverse: true });
  return text;
}

/** Run a ⌘P command by its id. */
async function runCommand(id) {
  await pressCmd("p");
  const item = await $(`[cmdk-item][data-value="${id}"]`);
  await item.waitForExist({ timeout: 5_000 });
  await item.click();
}

/** Open a note by name through ⌘O, the way PAL-01 does. */
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

describe("Journeys: core (smoke)", function () {
  let root;

  before(async function () {
    root = await workspaceRoot();
  });

  it("WS-01 launching opens the last workspace with its sidebar", async function () {
    await $('aside, [data-sidebar-surface][data-workspace-open="true"]').waitForExist();
    await $('section[aria-label="Spaces"]').waitForExist({ timeout: 5_000 });
  });

  it("SB-01 ⌘[ hides the sidebar and ⌘\\ shows it again", async function () {
    await pressCmd("[");
    await $('button[aria-label="Show sidebar"]').waitForExist({ timeout: 3_000 });
    await pressCmd("\\");
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 3_000 });
  });

  it("SB-07 clicking the sidebar's Search field opens the command palette", async function () {
    const search = await $("[data-sidebar-surface-content] [data-sidebar-search-button]");
    await search.waitForExist({ timeout: 5_000 });
    strictEqual(await $("[data-sidebar-wordmark]").isExisting(), false, "no PENSÉE row");
    strictEqual((await search.getText()).replace(/\s+/g, ""), "Search⌘O");
    await search.click();
    await $("[cmdk-input]").waitForExist({ timeout: 5_000 });
    await browser.keys("Escape");
    await $("[cmdk-input]").waitForExist({ timeout: 5_000, reverse: true });
  });

  it("SB-08 / CAL-09 hovering a chrome toggle shows its label and shortcut", async function () {
    for (const [label, text] of [
      ["Hide sidebar", "Hide sidebar ⌘ ["],
      ["Show calendar", "Show calendar ⌘ ]"],
    ]) {
      strictEqual(await hoverTooltip(`button[aria-label="${label}"]`), text);
    }
  });

  it("SB-10 hovering Today or a space shows what it does and its shortcut", async function () {
    for (const [selector, text] of [
      ['button[aria-keyshortcuts="Meta+T"]', "Open today's note ⌘ T"],
      ['button[data-space-key="projects"]', "Go to Projects ⌥ P"],
      ['button[data-space-key="library"]', "Go to Library ⌥ L"],
      ['button[data-space-key="files"]', "Go to Files ⌥ F"],
    ]) {
      strictEqual(await hoverTooltip(selector), text);
    }
  });

  it("SB-11 ⌘G then P, L or F opens Projects, Library or Files, from inside a note", async function () {
    // The go key: captured before the editor, so the letter never types.
    for (const [letter, key] of [
      ["p", "projects"],
      ["l", "library"],
      ["f", "files"],
    ]) {
      await openViaPalette("On writing");
      await typeInEditor("");
      const before = await browser.execute(
        () => document.querySelector(".cm-content")?.textContent ?? "",
      );
      await pressKey("g", { meta: true, code: "KeyG", inFocus: true });
      // Each sidebar row shows its letter in a box while ⌘G waits.
      const hint = await $('[data-go-key="t"]');
      await hint.waitForExist({ timeout: 2_000, timeoutMsg: "⌘G boxed no letters" });
      const boxes = await browser.execute(() =>
        [...document.querySelectorAll("[data-go-key]")].map(
          (box) => `${box.textContent} ${box.previousElementSibling?.textContent?.trim()}`,
        ),
      );
      strictEqual(boxes.join(", "), "T Today, P Projects, L Library, F Files");
      strictEqual(
        await $("[data-go-key-hint]").isExisting(),
        false,
        "the hint tray showed beside the sidebar",
      );
      await pressKey(letter, { code: `Key${letter.toUpperCase()}`, inFocus: true });
      await $(`button[data-space-key="${key}"][aria-current="page"]`).waitForExist({
        timeout: 5_000,
        timeoutMsg: `⌘G ${letter.toUpperCase()} never opened ${key}`,
      });
      await hint.waitForExist({ timeout: 2_000, reverse: true });
      if (letter === "p") {
        await openViaPalette("On writing");
        const after = await browser.execute(
          () => document.querySelector(".cm-content")?.textContent ?? "",
        );
        strictEqual(after, before, "the letter after ⌘G typed into the note");
      }
    }

    // Sidebar hidden: a tray at the bottom centre, above the note footer, names the letters.
    await openViaPalette("On writing");
    await pressKey("\\", { meta: true, code: "Backslash", inFocus: true });
    await $('[data-go-key="t"]').waitForExist({ timeout: 2_000, reverse: true });
    await pressKey("g", { meta: true, code: "KeyG", inFocus: true });
    const tray = await $("[data-go-key-hint]");
    await tray.waitForExist({
      timeout: 2_000,
      timeoutMsg: "⌘G showed no tray with the sidebar hidden",
    });
    const place = await browser.execute(() => {
      const box = document.querySelector("[data-go-key-hint]").getBoundingClientRect();
      return {
        text: document.querySelector("[data-go-key-hint]").textContent,
        offCentre: Math.abs(box.left + box.width / 2 - window.innerWidth / 2),
        gapBelow: window.innerHeight - box.bottom,
      };
    });
    strictEqual(place.text, "⌘GthenTTodayPProjectsLLibraryFFiles");
    ok(place.offCentre <= 1, `the tray sits ${place.offCentre}px off centre`);
    ok(
      place.gapBelow >= 44,
      `the tray covers the note footer (${place.gapBelow}px from the bottom)`,
    );
    await pressKey("Escape", { code: "Escape", inFocus: true });
    await tray.waitForExist({ timeout: 3_000, reverse: true });
    await pressKey("\\", { meta: true, code: "Backslash", inFocus: true });
    await $('section[aria-label="Spaces"]').waitForExist({ timeout: 2_000 });
  });

  it("SB-09 the Spaces section lists Projects, Library and Files", async function () {
    await $('section[aria-label="Spaces"] [data-space-key]').waitForExist({ timeout: 5_000 });
    const keys = await browser.execute(() =>
      [...document.querySelectorAll('section[aria-label="Spaces"] [data-space-key]')]
        .map((el) => el.getAttribute("data-space-key"))
        .filter((key) => !key.startsWith("note:")),
    );
    strictEqual(keys.join(","), "projects,library,files");
  });

  it("PAL-01 ⌘O finds a note by name and opens it", async function () {
    await openViaPalette("Welcome");
    ok((await editorText()).includes("A note to open first"), "Welcome's text shows");
  });

  it("ED-01 typing in a note saves it to disk", async function () {
    const path = `${root}/Welcome.md`;
    await typeInEditor(" typed by QA");
    await browser.waitUntil(async () => (await readFile(path)).includes("typed by QA"), {
      timeout: 5_000,
      timeoutMsg: "the typed text never reached Welcome.md",
    });
  });

  it("LNK-01 clicking a [[link]] opens its page in a column beside", async function () {
    await openViaPalette("On writing");
    const link = await $(".cm-wiki-link=Welcome");
    await link.waitForExist({ timeout: 5_000 });
    await mouseClick(link);
    await waitForTitle("Welcome");
  });

  it("ED-02 renaming from the title renames the file", async function () {
    const title = await frontTitleField();
    await title.click();
    await title.setValue("Welcome renamed");
    await browser.keys(["Enter"]);
    await waitForFile(`${root}/Welcome renamed.md`);
    ok(!(await fileExists(`${root}/Welcome.md`)), "the old name is gone");
    strictEqual(await activeTitle(), "Welcome renamed");
  });

  it("CMP-01 ⌘N, a title and text, ⌘↵ makes the note and opens it", async function () {
    await pressCmd("n");
    // The box has its dialog role only beside other UI: find it by its field.
    await $("input.composer-title").waitForExist({ timeout: 5_000 });
    await fillField('.composer input[aria-label="Title"]', "Composer note");
    await fillField('.composer textarea[aria-label="Text"]', "Written in the composer.");
    await browser.execute(() => {
      document.querySelector(".composer textarea").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await waitForFile(`${root}/Composer note.md`);
    await waitForTitle("Composer note");
    ok((await readFile(`${root}/Composer note.md`)).includes("Written in the composer."));
  });

  it("DN-01 Today in the sidebar opens today's note", async function () {
    const today = await $(
      '//section[@aria-label="Spaces"]/preceding::button[contains(., "Today")][1]',
    );
    await today.click();
    await waitForFile(`${root}/${dayStamp()}.md`);
    await waitForTitle(dayStamp());
  });

  it("DN-04 ⌘T opens today's note from another note", async function () {
    await openViaPalette("On writing");
    await pressCmd("t");
    await waitForTitle(dayStamp());
  });

  it("CMP-03 New Note for Today in ⌘P, text, ⌘↵ adds it to today's note and opens it", async function () {
    await openViaPalette("On writing");
    await runCommand("new-today-note");
    await $('[role="dialog"][aria-label="New note"]').waitForExist({ timeout: 5_000 });
    await fillField('[aria-label="New note"] textarea[aria-label="Text"]', "A line for today.");
    await browser.execute(() => {
      document.querySelector('[role="dialog"][aria-label="New note"] textarea').dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await waitForTitle(dayStamp());
    ok((await readFile(`${root}/${dayStamp()}.md`)).includes("A line for today."));
  });

  it("CMP-06 New Note for Today with nothing typed, ⌘↵ opens today's note", async function () {
    await openViaPalette("On writing");
    await runCommand("new-today-note");
    const button = await $('[aria-label="New note"] button.composer-submit');
    await button.waitForExist({ timeout: 5_000 });
    strictEqual((await button.getText()).replace("⌘↵", "").trim(), "Open today");
    // A day's note always opens: there's no staying, so no chevron.
    ok(!(await $('[aria-label="New note"] .composer-submit-menu').isExisting()), "no chevron");
    await browser.execute(() => {
      document.querySelector('[role="dialog"][aria-label="New note"] input').dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await waitForTitle(dayStamp());
  });

  it("CMP-02 ⌘N, a title, ⌘⇧↵ makes the note and stays, with an Added notice", async function () {
    await openViaPalette("On writing");
    await pressCmd("n");
    const title = '[aria-label="New note"] input[aria-label="Title"]';
    await $(title).waitForExist({ timeout: 5_000 });
    await fillField(title, "Kept note");
    await browser.execute((sel) => {
      document.querySelector(sel).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, title);
    await waitForFile(`${root}/Kept note.md`);
    await $('//*[@role="status"][contains(., "Added Kept note")]').waitForExist({
      timeout: 5_000,
    });
    strictEqual(await activeTitle(), "On writing");
  });

  it("CMP-07 the chevron beside the button offers open (⌘↵) and stay (⌘⇧↵)", async function () {
    await openViaPalette("On writing");
    await pressCmd("n");
    const title = '[aria-label="New note"] input[aria-label="Title"]';
    await $(title).waitForExist({ timeout: 5_000 });
    // Radix opens its menu on pointerdown, which the WebDriver plugin's click
    // does not send, so the press is dispatched the way a mouse sends it.
    const openMenu = () =>
      browser.execute(() => {
        const trigger = document.querySelector('[aria-label="New note"] .composer-submit-menu');
        const init = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" };
        trigger.dispatchEvent(new PointerEvent("pointerdown", init));
      });
    const menuItems = () =>
      browser.execute(() =>
        [...document.querySelectorAll('[role="menuitem"]')].map(
          (item) => `${item.firstChild.textContent} ${item.querySelector("kbd")?.textContent}`,
        ),
      );

    // A video the QA vault's Library doesn't have (one it has reads Open note).
    await fillField(title, "https://www.youtube.com/watch?v=M7lc1UVf-VE");
    // The chevron sits flush on the button's right, on the same line and height.
    const [button, chevron] = await browser.execute(() =>
      [".composer-submit:not(.composer-submit-menu)", ".composer-submit-menu"].map((sel) => {
        const box = document
          .querySelector(`[aria-label="New note"] ${sel}`)
          .getBoundingClientRect();
        return { top: box.top, height: box.height, left: box.left, right: box.right };
      }),
    );
    strictEqual(chevron.top, button.top);
    strictEqual(chevron.height, button.height);
    strictEqual(chevron.left, button.right);
    const iconWidth = await browser.execute(
      () =>
        document
          .querySelector('[aria-label="New note"] .composer-submit-menu svg')
          .getBoundingClientRect().width,
    );
    strictEqual(iconWidth, 14, "the chevron's icon shows at its full 14px");
    await openMenu();
    await $('[role="menuitem"]').waitForExist({ timeout: 3_000 });
    const texts = await menuItems();
    strictEqual(texts[0], "Add video and open it ⌘↵");
    strictEqual(texts[1], "Add video and stay here ⌘⇧↵");
    await pressKey("Escape");
    await $('[role="menuitem"]').waitForExist({ timeout: 3_000, reverse: true });

    await fillField(title, "Stay note");
    await openMenu();
    const stay = await $('//*[@role="menuitem" and contains(., "Create note and stay here")]');
    await stay.waitForExist({ timeout: 3_000 });
    await stay.click();
    await waitForFile(`${root}/Stay note.md`);
    await $('//*[@role="status"][contains(., "Added Stay note")]').waitForExist({
      timeout: 5_000,
    });
    strictEqual(await activeTitle(), "On writing");
  });

  it("PRJ-01 Projects shows the projects by status", async function () {
    await $('button[data-space-key="projects"]').click();
    await browser.waitUntil(
      async () => {
        const text = await browser.execute(() => document.body.innerText);
        return text.includes("Launch site") && text.includes("Old idea");
      },
      { timeout: 10_000, timeoutMsg: "Projects never listed the seeded projects" },
    );
  });

  it("LIB-01 Library shows the seeded book", async function () {
    await $('button[data-space-key="library"]').click();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.body.innerText)).includes("A book"),
      { timeout: 10_000, timeoutMsg: "Library never showed the seeded book" },
    );
  });

  it("SET-01 the palette opens Preferences", async function () {
    await pressCmd("p");
    const input = await $("[cmdk-input]");
    await input.waitForExist({ timeout: 5_000 });
    await input.setValue("Settings");
    const item = await $('//*[@cmdk-item][contains(., "Settings")]');
    await item.waitForExist({ timeout: 5_000 });
    await item.click();
    await $("//h1[normalize-space(.)='Preferences']").waitForExist({ timeout: 5_000 });
  });
});
