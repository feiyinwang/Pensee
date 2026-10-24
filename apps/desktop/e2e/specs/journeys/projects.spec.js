// Projects (PRJ in docs/qa/user-journeys.md, SPECs/add-to-projects-spec.md):
// a project note the app writes shows on the board at once, as Add to
// Projects and Add project write them. Runs on the seeded QA vault.
import { ok, strictEqual } from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { invoke, waitForFile, workspaceRoot } from "./_helpers.js";

/** The board's card for the note at `path`: its column (`data-cell`), or
 *  null while there is no card. Not page text: the sidebar's Recents names
 *  a note the moment it is written. */
const cardColumn = (path) =>
  browser.execute((p) => {
    const card = document.querySelector(`[data-card-id="${CSS.escape(p)}"]`);
    return card ? (card.closest("[data-cell]")?.getAttribute("data-cell") ?? "") : null;
  }, path);

describe("Journeys: projects", () => {
  // First in the file, so Projects reads the template fresh when it opens.
  it("PRJ-12 a new project holds only its fields, none of the vault's template", async function () {
    const root = await workspaceRoot();
    // A Templater project template like an Obsidian vault's: sections, a
    // Dataview query and properties of its own.
    mkdirSync(`${root}/Templates`, { recursive: true });
    mkdirSync(`${root}/.obsidian/plugins/templater-obsidian`, { recursive: true });
    writeFileSync(
      `${root}/Templates/Project.md`,
      '---\nType: Project\nOrganization: Acme\nStatus: Done\n---\n# Tasks\n\n# Meetings\n\n```dataview\nWhere contains(Project, "<% tp.file.title %>")\n```\n',
    );
    writeFileSync(
      `${root}/.obsidian/plugins/templater-obsidian/data.json`,
      JSON.stringify({
        templates_folder: "Templates",
        folder_templates: [{ folder: "Projects", template: "Templates/Project.md" }],
      }),
    );

    await $('button[data-space-key="projects"]').click();
    await browser.waitUntil(
      async () => (await cardColumn(`${root}/Projects/Launch site.md`)) !== null,
      { timeout: 10_000, timeoutMsg: "Projects never listed the seeded projects" },
    );
    await $('button[aria-label^="Add project to"]').click();
    const field = await $('input[aria-label="New project name"]');
    await field.waitForExist({ timeout: 3_000 });
    await field.setValue("Garden plan");
    await browser.keys("Enter");

    // In the template's folder, with only Type and the column's Status.
    const path = `${root}/Projects/Garden plan.md`;
    await waitForFile(path);
    await browser.waitUntil(async () => (await cardColumn(path)) !== null, {
      timeout: 5_000,
      timeoutMsg: "The new project never showed on the board",
    });
    const content = readFileSync(path, "utf8");
    ok(
      /^---\nType: Project\nStatus:[^\n]*\n---\n$/.test(content),
      `the note holds ${JSON.stringify(content)}`,
    );
    strictEqual(content.includes("Organization"), false);
  });

  it("PRJ-10 a project note written by the app shows on the board in No status", async function () {
    const root = await workspaceRoot();
    await $('button[data-space-key="projects"]').click();
    await browser.waitUntil(
      async () => (await cardColumn(`${root}/Projects/Launch site.md`)) !== null,
      { timeout: 10_000, timeoutMsg: "Projects never listed the seeded projects" },
    );

    // As createProjectNote makes one: an exclusive create, then the content.
    const path = `${root}/Trip plan.md`;
    const created = await invoke("create_file", { path });
    ok(created.ok, `create_file failed: ${created.error}`);
    const written = await invoke("write_file", {
      path,
      content: "---\nType: Project\nStatus:\n---\nBook flights, a hotel and a rail pass.\n",
    });
    ok(written.ok, `write_file failed: ${written.error}`);

    await browser.waitUntil(async () => (await cardColumn(path)) !== null, {
      timeout: 5_000,
      timeoutMsg: "The new project never showed on the board",
    });
    const column = await cardColumn(path);
    // `none` is No status (lib/projects.ts).
    ok(column === "none", `the card is in column "${column}", not No status`);
  });
});
