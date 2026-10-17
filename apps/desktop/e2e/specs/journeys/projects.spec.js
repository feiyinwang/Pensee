// Projects (PRJ in docs/qa/user-journeys.md, SPECs/add-to-projects-spec.md):
// a project note the app writes shows on the board at once, as Add to
// Projects and Add project write them. Runs on the seeded QA vault.
import { ok } from "node:assert/strict";
import { invoke, workspaceRoot } from "./_helpers.js";

/** The board's card for the note at `path`: its column (`data-cell`), or
 *  null while there is no card. Not page text: the sidebar's Recents names
 *  a note the moment it is written. */
const cardColumn = (path) =>
  browser.execute((p) => {
    const card = document.querySelector(`[data-card-id="${CSS.escape(p)}"]`);
    return card ? (card.closest("[data-cell]")?.getAttribute("data-cell") ?? "") : null;
  }, path);

describe("Journeys: projects", () => {
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
