# Table In-Place Cell Editing Spec

Stage: **ready to build**. Every mechanism is already in the editor: the folded `TableWidget`, the `selectionTouchesRange` source mode, the board's zero-chrome in-widget textarea, and the live-position lookup rules in `docs/editor.md`. What this spec adds is a cell editor inside the rendered table and a write path from a cell back to its span in the markdown.

## Summary

Clicking anywhere in a rendered table today drops the caret into the table's markdown range, which flips the whole block to source mode: the orange, monospace, pipe-delimited view. For a wide table with prose cells that view is a wall of text, and editing one word means finding it among pipes. Users expect to click a cell and type, the way Notion, Obsidian's live preview and every spreadsheet work.

This spec keeps the table rendered while editing. A click in a cell opens an editor inside that cell showing the cell's raw markdown. Commit writes only that cell's span back to the document, and the widget re-renders in place. Source mode stays available through an explicit toggle for the cases the cell editor cannot cover: restructuring columns, fixing a broken delimiter row, or pasting a whole table.

## Why

- **Who**: anyone keeping structured notes, comparison tables, meeting summaries. The author's tables have four columns of full sentences.
- **Scenario**: fix a typo, update a status, add a name to "who agreed", append a row.
- **Need**: edit a cell where it is displayed, without the table changing shape underneath the pointer.
- **Evidence**: pasted tables from the previous spec land rendered, so the first edit is now the first time the user sees source mode, and the contrast makes it feel like a mode error rather than a feature.
- **Outcome**: the table never leaves its rendered form during ordinary edits. Source mode becomes a deliberate choice.

## Goals

- Click a header or body cell to edit that cell in place. The rest of the table stays rendered.
- Commit on blur, Enter or Tab. Tab and Shift+Tab move to the next and previous cell, Enter moves down a row. Escape discards.
- Tab from the last cell appends an empty row.
- Write back only the edited cell's text, leaving every other byte of the table untouched, including the spacing of neighbouring cells.
- One undo step per committed cell, undoable from the main editor with `Cmd+Z`.
- Keep source mode reachable: a code toggle on the widget, and the existing path when the caret enters the range by keyboard.
- Edits made outside the editor while a cell is open (file watcher reload, undo from the menu) never corrupt the document. The open edit is dropped, not merged blindly.

## Non-Goals

- Rich formatting toolbar inside cells. Cells show raw inline markdown while editing, so `**bold**` is typed as `**bold**`, the same contract Obsidian uses. Rendering happens on commit.
- Adding, deleting or reordering columns, and setting alignment. A column menu is a follow-up.
- Deleting rows from the widget. Use source mode.
- Multi-cell selection, drag-fill, or copying a rectangular range.
- Arrow-key navigation between cells from inside the cell editor. Arrows move within the cell text.
- Changing how source mode looks.

## UX Decisions

**Entering a cell.** A single click on a cell opens the editor with the caret at the end of the cell's text. (Mapping the click point through rendered markdown back to a raw-source offset is a follow-up; the end is the least surprising place for the common "append a name" edit.) The editor is a `textarea` styled to be invisible: same font, size, line height, padding and alignment as the rendered cell, no border or background change beyond a faint focus ring on the cell. The cell keeps its width, so nothing else in the table shifts. The textarea auto-grows with its content.

**What the cell shows while editing.** The cell's raw markdown, with `\|` shown as `|` and `<br>` shown as a real newline. On commit those are re-escaped. This is the same convention the paste converter uses, so the two agree on what a cell's text means.

**Committing.**

- **Blur** commits. Clicking another cell commits the first and opens the second.
- **Enter** commits and opens the cell directly below. In the last row it just commits. **Shift+Enter** inserts a newline inside the cell, which becomes `<br>`.
- **Tab** commits and opens the next cell, wrapping to the first cell of the next row. In the last cell of the last row it appends a new empty row and opens its first cell. **Shift+Tab** goes back; in the first cell it just commits.
- **Escape** discards the edit and restores the rendered cell.
- A commit with no change writes nothing, so it creates no undo step.

**After commit.** Focus returns to the main editor with the caret where it was before the edit began, outside the table, so `Cmd+Z` reaches the editor's history. The table stays rendered.

**Reaching source mode.** A small code icon in the widget's top-right corner, visible on hover and while a cell is focused, mirrors the mermaid canvas toggle. Clicking it range-selects the table, which is what flips the fold into source mode today. Moving the caret into the table's range with the keyboard from the paragraph above or below still unfolds it, as before. Clicking a rendered cell no longer does.

**Empty cells.** Render at their normal size with the same click target, so there is always somewhere to click in a sparse row.

**Header cells** edit exactly like body cells.

## States To Cover

- Click a body cell, type, click elsewhere: cell updated, table still rendered.
- Click a header cell: same.
- Enter in a middle row: commit and the cell below opens.
- Tab through a row and off its end: next row's first cell opens.
- Tab from the last cell: a new row appears with the first cell open.
- Escape after typing: original text back, no document change.
- Commit with a `|` in the text: rendered as a pipe, stored as `\|`, table shape unchanged.
- Commit with Shift+Enter newline: rendered on two lines, stored as `<br>`.
- Commit with leading or trailing spaces: trimmed, since the cell parser trims.
- A cell containing inline markdown: editor shows `**bold**`, rendered cell shows bold.
- Clear a cell to empty: stored as an empty cell, the column count unchanged.
- File changes on disk while a cell is open: the widget rebuilds, the open edit is discarded, no write happens.
- Undo after a commit: the cell's previous text comes back, table still rendered.
- Click the code toggle: source mode, identical to today. Click out: rendered again.
- Two tables in one document with identical rows: the edit lands in the clicked one, because position is resolved from the clicked DOM, not by searching for text.

## Implementation Notes

- **Widget stays a replace decoration.** `TableWidget` sets `contentEditable = "false"` on its wrapper and `ignoreEvent` returns `true` for pointer events inside cells, so CodeMirror does not move its selection into the table range on click. That single change is what stops the click from unfolding. `selectionTouchesRange` remains the only source-mode switch, per `docs/editor.md`; the code toggle feeds it a range selection with `view.scrollSnapshot()`, exactly as the mermaid toggle does.
- **Cell editor** lives in `table-decorations.ts` beside the widget. It follows the board's `startTextEdit` shape: one textarea at a time, `blur` commits, `keydown` stops propagation so the editor's keymaps do not fire, Escape restores. The widget holds a reference to the open editor so `updateDOM` skips that cell instead of wiping it.
- **Position lookup happens at commit time, never at open time.** Resolve the `Table` node from `view.posAtDOM(cellElement)` with both `resolveInner` sides, walk to `Table`, then to the row: `TableHeader` for the header, else the `TableRow` at index `rowIdx`. Do not store `node.from` on the widget or on the editor. If the walk fails, because the widget was detached by a rebuild, log and drop the edit.
- **Write only the cell's span.** New pure module `apps/desktop/src/lib/table-cell-edit.ts` exports `cellSpanInRowLine(lineText, colIdx): { from, to }` returning the offsets of the cell's trimmed content inside one row line, or the insertion point for an empty cell, honouring `\|`. It reuses the same pipe-splitting rule as `parseCells`. The commit transaction replaces `[line.from + from, line.from + to]` with the escaped text. Padding spaces around neighbouring cells are never touched, so a hand-aligned table stays aligned. Also exports `escapeCellText` and `unescapeCellText` for the `\|` and `<br>` mapping, sharing the escape with the paste converter so there is one definition.
- **Row append** is a second change in the same transaction: insert `\n| ` + `" | ".repeat(cols - 1)` + ` |` after the last row line. Header width comes from the parsed table, not the last row, so a ragged last row does not propagate.
- **Transaction** is tagged `userEvent: "input"` and includes `view.scrollSnapshot()`, since a taller or shorter cell shifts the heightmap.
- **Re-render** happens through the existing `eq` and `updateDOM` path: `rawText` changes, shape is the same, so cells are refilled in place. Appending a row changes the shape and rebuilds the widget, which is fine because the editor has already been closed by then.
- **Row and column indices** come from DOM position (`rowIndex`, `cellIndex`) at commit time, so a widget that was rebuilt between open and commit does not carry stale indices.
- **Focus return**: on commit, `view.focus()` without dispatching a selection, so the caret stays where it was. Because the caret was outside the table, the fold does not change.
- No Rust changes.

## Files Expected To Change

- `apps/desktop/src/components/editor-area/table-decorations.ts` — non-editable wrapper, `ignoreEvent`, cell editor open and commit, code toggle, `updateDOM` skipping the live cell and absorbing row-count changes in place.
- `apps/desktop/src/components/editor-area/drag-selection-gate.ts` — table widget joins the mermaid widget in the pointerdown skip list.
- new `apps/desktop/src/lib/table-cell-edit.ts` — cell span math, escape and unescape.
- `apps/desktop/src/lib/tabular-paste.ts` — import the shared escape instead of its local one.
- new `apps/desktop/tests/table-cell-edit.test.ts` — span math on padded, escaped, empty and ragged rows; escape round-trips.
- `apps/desktop/tests/table-cell-edit.test.ts` also covers the commit change on a real state: single-cell replacement leaves the rest of the line byte-identical, header edit, ragged-row padding, row append.
- new `apps/desktop/e2e/specs/table-cell-edit.spec.js` — runtime flow in the built app: press a cell (the harness's `click()` emits no mousedown, so the spec dispatches the real press sequence), Enter/Tab/Escape, byte-exact file contents, source toggle.
- `docs/editor.md` — the "conditional replace ↔ source-line styling" entry: the table now edits cells in place and unfolds only on explicit toggle or keyboard entry.
- `SPECs/table-cell-markdown-preview-spec.md` — note that its "rich cell editing" non-goal is superseded by this spec.
- `CHANGELOG.md`, `TODOS.md`.

## Acceptance Criteria

- Clicking a cell in a rendered table does not show markdown source. An editor opens inside the cell.
- Typing and clicking away updates that cell and nothing else in the table's markdown. A diff of the document shows exactly the cell's characters changed.
- Enter, Tab, Shift+Tab and Escape behave as specified, and Tab from the last cell appends a row.
- A `|` typed in a cell does not split the column.
- `Cmd+Z` after a commit restores the cell without unfolding the table.
- The code toggle unfolds to source mode, and clicking outside refolds.
- Editing a file on disk while a cell is open does not write the stale cell.
- `vp check` and `vp test` pass with the new tests.

## Follow-Ups

- Column operations: add, delete, move, alignment, from a header context menu.
- Arrow-key navigation between cells at the text boundaries.
- Keyboard entry into the first cell from the paragraph above, instead of unfolding.
- Delete row.

## Change Log

- 2026-09-02 — Created after the paste-as-table feature made source mode the first thing a user sees on their first edit.
- 2026-09-02 — Built. Caret opens at the end of the cell rather than the click point. Runtime-verified through a new e2e spec; the harness's `click()` emits no mousedown, so the spec dispatches a real press sequence.
