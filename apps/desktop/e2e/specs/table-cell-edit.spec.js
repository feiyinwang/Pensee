import { ok, equal, deepEqual } from "node:assert/strict";

// In-place table cell editing (see SPECs/table-in-place-cell-editing-spec.md).
// A click on a rendered cell must open an editor inside that cell instead of
// unfolding the table to markdown source; commits write only that cell; Tab
// past the last cell appends a row; the code toggle still reaches source mode.
//
// Requires a restorable workspace; self-skips on the welcome screen.
describe("table in-place cell editing", function () {
  const FILE_STEM = "table-cell-edit-e2e";
  const DOC = [
    "# Cell edit check",
    "",
    "| Name | Count |",
    "| --- | ---: |",
    "| Tea   |   2 |",
    "| Coffee | 5 |",
    "",
    "after",
    "",
  ].join("\n");

  let workspaceRestored = false;
  let filePath = null;

  async function invoke(cmd, args) {
    return browser.executeAsync(
      (c, a, done) => {
        window.__TAURI_INTERNALS__
          .invoke(c, a)
          .then((v) => done({ ok: true, value: v }))
          .catch((e) => done({ ok: false, error: e && e.message ? e.message : String(e) }));
      },
      cmd,
      args,
    );
  }

  const key = (k, extra = {}) =>
    browser.execute(
      (kk, ex) => {
        const target = document.activeElement || document.body;
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key: kk, bubbles: true, cancelable: true, ...ex }),
        );
      },
      k,
      extra,
    );

  const editorState = () =>
    browser.execute(() => {
      const area = document.querySelector("textarea.cm-table-cell-editor");
      const cell = area ? area.closest("th, td") : null;
      const row = cell ? cell.parentElement : null;
      return {
        open: !!area,
        value: area ? area.value : null,
        focused: area ? document.activeElement === area : false,
        rowIdx: row ? (row.parentElement.tagName === "THEAD" ? -1 : row.sectionRowIndex) : null,
        colIdx: cell ? cell.cellIndex : null,
        sourceLines: document.querySelectorAll(".cm-table-source-line").length,
        widgets: document.querySelectorAll(".cm-table-widget").length,
      };
    });

  // tauri-webdriver's element.click() emits only a bare `click` (no mousedown,
  // no pointerdown, no coordinates), which is not what a mouse does and cannot
  // reach mousedown-driven UI. Dispatch the sequence a real press produces.
  const pressCell = (rowIdx, colIdx) =>
    browser.execute(
      (r, c) => {
        const table = document.querySelector(".cm-table-widget table");
        const cell = r < 0 ? table.tHead.rows[0].cells[c] : table.tBodies[0].rows[r].cells[c];
        const rect = cell.getBoundingClientRect();
        const init = {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };
        cell.dispatchEvent(new PointerEvent("pointerdown", { ...init, isPrimary: true }));
        cell.dispatchEvent(new MouseEvent("mousedown", init));
        cell.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0, isPrimary: true }));
        cell.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }));
        cell.dispatchEvent(new MouseEvent("click", { ...init, buttons: 0 }));
      },
      rowIdx,
      colIdx,
    );

  const bodyCells = () =>
    browser.execute(() =>
      Array.from(document.querySelectorAll(".cm-table-widget tbody tr")).map((tr) =>
        Array.from(tr.cells).map((td) => td.textContent),
      ),
    );

  before(async function () {
    workspaceRestored = await $('button[aria-label="Hide sidebar"]')
      .waitForExist({ timeout: 20_000 })
      .catch(() => false);
    if (!workspaceRestored) return;

    const recents = await invoke("get_recent_workspaces", {});
    const root = recents.ok && Array.isArray(recents.value) ? recents.value[0] : null;
    ok(root, "no workspace root to seed the table document into");

    filePath = `${root}/${FILE_STEM}.md`;
    const wrote = await invoke("write_file", { path: filePath, content: DOC });
    ok(wrote.ok, `failed to seed ${filePath}: ${wrote.error}`);

    await browser.execute(() => window.location.reload());
    await $('button[aria-label="Hide sidebar"]').waitForExist({ timeout: 20_000 });
  });

  beforeEach(function () {
    if (!workspaceRestored) this.skip();
  });

  after(async function () {
    if (filePath) await invoke("delete_entry", { path: filePath });
  });

  it("opens the seeded document from the sidebar", async function () {
    const row = await $(`span*=Cell edit check`);
    await row.waitForExist({ timeout: 20_000 });
    await row.click();
    await browser.waitUntil(
      async () => (await $(".cm-content").getText()).includes("Cell edit check"),
      { timeout: 15_000, timeoutMsg: "the seeded document never became the active one" },
    );
    await browser.waitUntil(async () => (await $$(".cm-table-widget table")).length === 1, {
      timeout: 15_000,
      timeoutMsg: "table widget never rendered",
    });
  });

  it("clicking a cell opens an editor in place without unfolding to source", async function () {
    await pressCell(0, 1); // "2"

    const state = await editorState();
    ok(state.open, `no cell editor opened: ${JSON.stringify(state)}`);
    equal(state.value, "2");
    ok(state.focused, "cell editor did not take focus");
    equal(state.sourceLines, 0, "the table unfolded to source on click");
    equal(state.widgets, 1, "the rendered table went away");
    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/table-cell-edit-open.png`);
    }
  });

  it("Enter commits the cell and moves down; the table stays rendered", async function () {
    await $("textarea.cm-table-cell-editor").addValue("3");
    await key("Enter");

    await browser.waitUntil(async () => (await bodyCells())[0][1] === "23", {
      timeout: 5_000,
      timeoutMsg: "the edited cell did not re-render with the new text",
    });
    const state = await editorState();
    ok(state.open, "Enter should have opened the cell below");
    deepEqual([state.rowIdx, state.colIdx, state.value], [1, 1, "5"]);
    equal(state.sourceLines, 0, "the table unfolded after a commit");
  });

  it("Tab past the last cell appends a row and Escape discards", async function () {
    await key("Tab");
    const state = await editorState();
    deepEqual([state.rowIdx, state.colIdx, state.value], [2, 0, ""]);
    equal((await bodyCells()).length, 3, "no row was appended");

    await $("textarea.cm-table-cell-editor").addValue("Milk");
    await key("Tab");
    await $("textarea.cm-table-cell-editor").addValue("9");
    await key("Escape");
    ok(!(await editorState()).open, "Escape left the editor open");
    deepEqual(await bodyCells(), [
      ["Tea", "23"],
      ["Coffee", "5"],
      ["Milk", ""],
    ]);
  });

  it("wrote only the edited cells to the file, byte for byte", async function () {
    const read = await invoke("read_file", { path: filePath });
    ok(read.ok, `read_file failed: ${read.error}`);
    const content = typeof read.value === "string" ? read.value : read.value.content;
    const expected = DOC.replace("| Tea   |   2 |", "| Tea   |   23 |").replace(
      "| Coffee | 5 |",
      "| Coffee | 5 |\n| Milk |  |",
    );
    equal(content, expected);
  });

  it("the code toggle still reaches source mode", async function () {
    await browser.execute(() => {
      const button = document.querySelector(".cm-table-source-toggle");
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      button.click();
    });
    await browser.waitUntil(async () => (await editorState()).sourceLines > 0, {
      timeout: 5_000,
      timeoutMsg: "the toggle did not unfold the table",
    });
    const text = await $(".cm-content").getText();
    ok(text.includes("| Tea   |   23 |"), `source view missing the edited row:\n${text}`);
    if (process.env.VERIFY_SHOT_DIR) {
      await browser.saveScreenshot(`${process.env.VERIFY_SHOT_DIR}/table-cell-edit-source.png`);
    }
  });
});
