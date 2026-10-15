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
  typeInEditor,
  waitForFile,
  waitForTitle,
  workspaceRoot,
} from "./_helpers.js";

const editorText = () =>
  browser.execute(() => {
    const editors = [...document.querySelectorAll(".cm-content")];
    const visible = editors.find((el) => el.offsetParent !== null);
    return visible ? visible.innerText : null;
  });

async function readFile(path) {
  const result = await invoke("read_file", { path });
  ok(result.ok, `read_file ${path} failed: ${result.error}`);
  return result.value.content;
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
    strictEqual((await search.getText()).replace(/\s+/g, ""), "Search⌘P");
    await search.click();
    await $("[cmdk-input]").waitForExist({ timeout: 5_000 });
    await browser.keys("Escape");
    await $("[cmdk-input]").waitForExist({ timeout: 5_000, reverse: true });
  });

  it("SB-08 / CAL-09 hovering a chrome toggle shows its label and shortcut", async function () {
    // The WebDriver plugin sends no pointer events: dispatch the hover React listens for.
    const hover = (label, type) =>
      browser.execute(
        (label, type) =>
          document
            .querySelector(`button[aria-label="${label}"]`)
            .dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse" })),
        label,
        type,
      );
    for (const [label, text] of [
      ["Hide sidebar", "Hide sidebar (⌘[)"],
      ["Show calendar", "Show calendar (⌘])"],
    ]) {
      await hover(label, "pointerover");
      const tip = await $("[data-chrome-tooltip]");
      await tip.waitForExist({ timeout: 3_000 });
      strictEqual(await tip.getText(), text);
      await hover(label, "pointerout");
      await tip.waitForExist({ timeout: 3_000, reverse: true });
    }
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

  it("CMP-01 ⌘N, a title and text, ⌘⇧↵ makes the note and opens it", async function () {
    await pressCmd("n");
    const dialog = await $('[role="dialog"][aria-label="New note"]');
    await dialog.waitForExist({ timeout: 5_000 });
    await fillField('[aria-label="New note"] input[aria-label="Title"]', "Composer note");
    await fillField(
      '[aria-label="New note"] textarea[aria-label="Text"]',
      "Written in the composer.",
    );
    await browser.execute(() => {
      document.querySelector('[role="dialog"][aria-label="New note"] textarea').dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          shiftKey: true,
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
    const hint = await browser.execute(
      () =>
        [...document.querySelectorAll("button")]
          .find((button) => button.textContent.startsWith("Today"))
          ?.querySelector("kbd")?.textContent ?? null,
    );
    strictEqual(hint, "⌘T", "Today carries its shortcut");
  });

  it("CMP-03 ⌘⇧N, text, ⌘↵ adds it to today's note and opens it", async function () {
    await openViaPalette("On writing");
    await pressCmd("n", { shift: true });
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

  it("CMP-06 ⌘⇧N with nothing typed, ⌘↵ opens today's note", async function () {
    await openViaPalette("On writing");
    await pressCmd("n", { shift: true });
    const button = await $('[aria-label="New note"] button.composer-submit');
    await button.waitForExist({ timeout: 5_000 });
    strictEqual((await button.getText()).replace("⌘↵", "").trim(), "Open today");
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
