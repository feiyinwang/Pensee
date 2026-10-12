import { ok, strictEqual } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Projects → Add project (SPECs/project-views-spec.md, "New project"). Needs a
// workspace (PROJECTS_VAULT) seeded with: a Templater folder template for
// `1. Project` whose note is `Type: Project` (Status: Done, a creation-date tag
// and a `tp.file.title` in its body), `1. Project/Wandy.md` (Ongoing), and two
// plain notes, `Trip.md` and `Trip planning.md`.

const VAULT = process.env.PROJECTS_VAULT;
const SHOTS = process.env.PROJECTS_SHOTS ?? "/tmp";
const read = (relative) => readFileSync(join(VAULT, relative), "utf-8");
const field = 'input[aria-label="New project name"]';

const options = () =>
  browser.execute(() =>
    [
      ...document.querySelectorAll(
        '[role="listbox"][aria-label="Projects to add"] [role="option"]',
      ),
    ].map((o) => ({ text: o.textContent, selected: o.getAttribute("aria-selected") === "true" })),
  );

/** Types `name` into the open field and waits until the list matches it. */
async function type(name, firstRow) {
  await $(field).addValue(name);
  await browser.waitUntil(async () => (await options())[0]?.text === firstRow, {
    timeout: 5_000,
    timeoutMsg: `first row never became ${firstRow}: ${JSON.stringify(await options())}`,
  });
}

/** Enter in the field, dispatched (driver key chords are flaky on WKWebView). */
const enter = () =>
  browser.execute((sel) => {
    document
      .querySelector(sel)
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }, field);

const waitFor = (check, message) =>
  browser.waitUntil(check, { timeout: 8_000, timeoutMsg: message });

describe("Projects: add project", function () {
  before(async function () {
    if (!VAULT) this.skip();
    await $('[data-sidebar-surface][data-workspace-open="true"]').waitForExist({ timeout: 15_000 });
    await $('[data-space-key="projects"]').click();
    await $('button[aria-label="Add project to To-do"]').waitForExist({ timeout: 10_000 });
  });

  it("suggests matching notes, with Create first when no note has the name", async function () {
    await $('button[aria-label="Add project to To-do"]').click();
    await type("Tri", "Create “Tri”");
    const rows = (await options()).map((o) => o.text);
    ok(rows.includes("Trip"), rows.join(" | "));
    ok(rows.includes("Trip planning"), rows.join(" | "));
    ok((await options())[0].selected, "Create is highlighted");
    // Laid out, not only in the DOM. (The e2e window is hidden, so motion never
    // runs its enter animation there and screenshots show the column without it.)
    const boxes = await browser.execute(() =>
      [
        'input[aria-label="New project name"]',
        '[role="listbox"][aria-label="Projects to add"]',
      ].map((sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return {
          top: r.top,
          height: r.height,
          width: r.width,
          opacity: getComputedStyle(document.querySelector(sel)).opacity,
        };
      }),
    );
    for (const box of boxes) ok(box.height > 20 && box.width > 150, JSON.stringify(boxes));
    await browser.pause(400);
    await browser.saveScreenshot(join(SHOTS, "project-add-suggest.png"));
  });

  it("Enter on an exact name takes that note instead of making another", async function () {
    await $(field).addValue("p");
    await waitFor(async () => (await options())[0]?.text === "Trip", "Trip never came first");
    ok(!(await options()).some((o) => o.text.startsWith("Create")), "no Create for a name in use");
    await enter();
    await waitFor(
      () => read("Trip.md").includes("Type: Project"),
      "Trip.md never became a project",
    );
    strictEqual(read("Trip.md"), "---\nType: Project\nStatus: To-do\n---\nPacking list\n");
    ok(!existsSync(join(VAULT, "1. Project/Trip.md")), "no second Trip");
  });

  it("a new name is made from the project template, in its folder", async function () {
    await type("Garden", "Create “Garden”");
    await enter();
    const path = join(VAULT, "1. Project/Garden.md");
    await waitFor(
      () => existsSync(path) && read("1. Project/Garden.md").includes("Status"),
      "no Garden",
    );
    const content = read("1. Project/Garden.md");
    ok(
      /^---\nType: Project\nPeople: \nOrganization: Container Living\nCreation Dates: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\nDeadline: \nStatus: To-do\nTakeaways: \ncssclasses:\n {2}- cards\n---\n# Tasks\n/.test(
        content,
      ),
      content,
    );
    ok(content.includes('contains(Project, "Garden")'), content);
    ok(!content.includes("<%"), content);
    await waitFor(
      () =>
        browser.execute(() =>
          [...document.querySelectorAll("[data-card-id]")].some((c) =>
            c.textContent.includes("Garden"),
          ),
        ),
      "Garden card never showed",
    );
  });

  it("a project already on the board shows its status and moves here", async function () {
    await type("Wandy", "WandyOngoing");
    await browser.pause(400);
    await browser.saveScreenshot(join(SHOTS, "project-add-existing.png"));
    await enter();
    await waitFor(() => read("1. Project/Wandy.md").includes("Status: To-do"), "Wandy never moved");
  });

  it("the list has New project too, and a new one there has no status", async function () {
    await $('button[data-value="list"]').click();
    await $("button=New project").click();
    await type("Reading club", "Create “Reading club”");
    await enter();
    const path = join(VAULT, "1. Project/Reading club.md");
    await waitFor(
      () => existsSync(path) && read("1. Project/Reading club.md").includes("Status"),
      "none",
    );
    ok(
      read("1. Project/Reading club.md").includes("\nStatus:\nTakeaways:"),
      read("1. Project/Reading club.md"),
    );
    await browser.saveScreenshot(join(SHOTS, "project-add-list.png"));
  });
});
