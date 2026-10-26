// Journeys CAL-01…CAL-06 in docs/qa/user-journeys.md: the calendar panel
// (Cmd+]) creates-or-opens the note for the day, week, month, quarter or year
// that is clicked. Every click is a real WebDriver click on the panel.
import { ok, strictEqual } from "node:assert/strict";
import {
  dayStamp,
  fileExists,
  invoke,
  mouseClick,
  pressCmd,
  waitForFile,
  waitForTitle,
  workspaceRoot,
} from "./_helpers.js";

/** ISO week and week-year, as lib/periodic-notes.ts names them. */
function isoWeekStem(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 864e5 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const panel = () => $('aside[aria-label="Calendar"]');

async function switchView(label) {
  // Radix opens its menu on pointerdown, which the WebDriver plugin's click
  // does not send, so the press is dispatched the way a mouse sends it.
  await browser.execute(() => {
    const trigger = document.querySelector(
      'aside[aria-label="Calendar"] .calendar-panel-view button',
    );
    const init = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" };
    trigger.dispatchEvent(new PointerEvent("pointerdown", init));
  });
  const item = await $(`//*[@role="menuitem" and contains(., "${label}")]`);
  await item.waitForExist({ timeout: 3_000 });
  await item.click();
}

describe("Journeys: calendar panel", function () {
  const now = new Date();
  const today = dayStamp(now);
  const year = String(now.getFullYear());
  const month = today.slice(0, 7);
  const quarter = `${year}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  const week = isoWeekStem(now);
  let root;

  before(async function () {
    root = await workspaceRoot();
    // The seeded vault has no daily-note folder set, so notes land at its root.
    for (const stem of [today, week, month, quarter, year]) {
      const path = `${root}/${stem}.md`;
      if (await fileExists(path)) await invoke("delete_entry", { path });
    }
    await browser.refresh();
    root = await workspaceRoot();
    // ⌘] is heard once the layout has mounted its key hook; pressed earlier
    // (IPC answers before React has drawn), it does nothing.
    await $('button[aria-label="Show calendar"], button[aria-label="Hide calendar"]').waitForExist({
      timeout: 10_000,
    });
  });

  it("CAL-01 opens and closes with Cmd+] and the toggle button", async function () {
    await pressCmd("]");
    await (await panel()).waitForDisplayed({ timeout: 3_000 });
    await $('button[aria-label="Hide calendar"]').click();
    await (await panel()).waitForExist({ timeout: 3_000, reverse: true });
    await $('button[aria-label="Show calendar"]').click();
    await (await panel()).waitForDisplayed({ timeout: 3_000 });
  });

  it("CAL-02 clicking a day creates and opens its note", async function () {
    const day = await (await panel()).$(`[data-present] button[data-date="${today}"]`);
    await day.waitForClickable({ timeout: 3_000 });
    await day.click();
    await waitForFile(`${root}/${today}.md`);
    await waitForTitle(today);
    strictEqual(await day.getAttribute("aria-selected"), "true", "the open day takes the fill");
  });

  it("CAL-03 clicking a week number creates and opens the week's note", async function () {
    const label = `W${Number(week.split("-W")[1])}`;
    const cell = await (
      await panel()
    ).$(
      `//*[@data-present]//button[contains(@class,"calendar-panel-cell")][normalize-space(.)="${label}"]`,
    );
    await cell.waitForClickable({ timeout: 3_000 });
    await cell.click();
    await waitForFile(`${root}/${week}.md`);
    await waitForTitle(week);
  });

  it("CAL-04 Months view opens the month's and the quarter's note", async function () {
    await switchView("Months");
    const monthLabel = now.toLocaleString(undefined, { month: "short" });
    const grid = await (await panel()).$(".calendar-panel-grid");
    await (await grid.$(`button=${monthLabel}`)).click();
    await waitForFile(`${root}/${month}.md`);
    await waitForTitle(month);

    await (await grid.$(`button=${quarter.slice(5)}`)).click();
    await waitForFile(`${root}/${quarter}.md`);
    await waitForTitle(quarter);
  });

  it("CAL-05 Years view opens the year's note", async function () {
    await switchView("Years");
    const grid = await (await panel()).$(".calendar-panel-grid");
    await (await grid.$(`button=${year}`)).click();
    await waitForFile(`${root}/${year}.md`);
    await waitForTitle(year);
  });

  it("CAL-06 an existing note shows a dot, and Today returns to this month", async function () {
    await switchView("Days");
    await (await panel()).$("button=Today").click();
    const day = await (await panel()).$(`[data-present] button[data-date="${today}"]`);
    await day.waitForExist({ timeout: 3_000 });
    strictEqual(
      await day.getAttribute("data-marked"),
      "true",
      "today's note exists, so it has a dot",
    );
    ok(await fileExists(`${root}/${today}.md`));
  });

  it("CAL-07 ⌘-click opens the day's note in a column beside", async function () {
    // Another day of this month, so the note is new and opens next to today's.
    const other = new Date(now.getFullYear(), now.getMonth(), now.getDate() === 1 ? 2 : 1);
    const stem = dayStamp(other);
    const day = await (await panel()).$(`[data-present] button[data-date="${stem}"]`);
    await day.waitForExist({ timeout: 3_000 });
    await mouseClick(day, { metaKey: true });
    await waitForFile(`${root}/${stem}.md`);
    await waitForTitle(stem);
    const columns = await browser.execute(
      () => document.querySelectorAll("[data-column-tab]").length,
    );
    ok(columns >= 2, `expected the note in a new column, found ${columns} column(s)`);
  });
});
