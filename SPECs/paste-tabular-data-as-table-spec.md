# Paste Tabular Data As Table Spec

Stage: **ready to build**. The editor already owns every piece this needs (a DOM paste hook, a Tauri clipboard paste path, a GFM table parser, and the folded `TableWidget` renderer), so the open questions are conversion rules, not architecture.

## Summary

Pasting a table copied from a spreadsheet, a Google Doc, Notion, a web page, or a meeting-notes tool lands in Writer as tab-separated lines. Markdown has no idea that is a table, so the user gets one long run of prose per row with invisible tabs between the columns, and has to hand-type `|` and a `| --- |` delimiter row to get the rendered table. This spec makes the paste handler recognise tab-separated text and insert it as a GFM pipe table, which the existing `TableWidget` then renders through the same path a hand-written table takes. Nothing new is rendered. The only new code is a small, pure text-to-markdown converter and the wiring that decides when to run it.

Motivating example (copied from a design-system meeting summary):

```
Adoption approach	Recommended by	Who agreed or supported it	Caveats / disagreement
Install the package and start using it now…	Tamas	Cristian supported the rollout mechanics…	Philipp questioned whether partial migration…
Tokens-first, progressive migration…	Cristian, with Feiyin…	Feiyin supported it…	Final feasibility still required Andrii's confirmation…
```

Today this pastes as three paragraphs. After this spec it pastes as a four-column table with the first row as the header.

## Why

- **Who**: anyone who writes in Writer and collects data elsewhere. The immediate case is the author pasting meeting summaries and comparison tables produced by another tool into a note.
- **Scenario**: copy a table in Sheets, Excel, Numbers, Notion, Google Docs, Confluence, a browser page, or an AI chat, press `Cmd+V` in a note.
- **Need**: the content should look like a table right away, without a manual reformat step that scales with the number of cells.
- **Evidence**: the author hits this in daily use. Every listed source puts `text/plain` on the clipboard as tab-separated rows, so one rule covers all of them.
- **Outcome**: a copied table is a rendered table on the first paste. Time to a presentable table drops from minutes of typing pipes to zero.

## Goals

- Detect tab-separated tabular text in a paste and insert it as a GFM pipe table.
- Cover both paste entry points with one converter: the DOM `paste` event and the context-menu **Paste** action that reads the clipboard through Tauri.
- Produce markdown the existing `parseMarkdownTable` in `table-decorations.ts` parses, so the result renders in the folded table widget with the existing column-sizing rules.
- Keep a way to paste the raw text unchanged.
- Never convert inside a code fence, inline code, or an existing table cell.
- One undo step reverts the whole paste.

## Non-Goals

- Comma-separated values. Commas appear in ordinary prose, so a CSV heuristic produces false positives. A later phase can add it behind an explicit action.
- Parsing the `text/html` clipboard flavour. Every target source also writes tab-separated `text/plain`, so HTML parsing adds work without adding coverage in v1.
- Inferring column alignment from content, such as right-aligning numbers.
- Turning existing tab-separated lines already in a document into a table. That is a separate command, not a paste behaviour.
- Preserving spreadsheet formatting such as bold cells, merged cells, or colours.
- A setting to turn the behaviour off. Paste as plain text is the opt-out. Add a setting only if users ask.

## UX Decisions

**When conversion runs.** The pasted `text/plain` is treated as a table when all of these hold:

- It has at least two non-empty lines after trailing newlines are stripped. Spreadsheets append a trailing newline to every copy.
- Every non-empty line contains at least one tab, so there are at least two columns.
- The caret is not inside a fenced code block, inline code, or a table cell. These are resolved from the syntax tree at paste time, the same way the block handle resolves its target.

Anything that fails a check pastes exactly as today. A single row with tabs is not a table, because a GFM table needs a header row and at least a delimiter row, and a header-only table renders as an empty box. Indented code (four leading spaces) is treated as prose here, matching how the rest of the editor treats it.

**Where the table lands.** A pipe table must start on its own line. If the caret is mid-line, the converter inserts a newline before the table so the existing text keeps its line, and a newline after it so the following text does not join the last row. If the caret is on an empty line, no padding is added. Pasting over a selection replaces it, as every paste does.

**Header row.** The first pasted row becomes the header. This matches what every source means by its first row, and matches what markdown requires. There is no prompt.

**Cell content.**

- Cells are trimmed. Empty cells are allowed and stay empty.
- A literal `|` in a cell becomes `\|`, which `parseCells` already unescapes.
- Spreadsheets wrap a cell in double quotes when it holds a newline, a tab, or a quote, and double any inner quote. The converter unwraps these: a quoted cell may span lines until its closing quote, and `""` becomes `"`. Unquoted cells are taken as-is, so a stray quote in prose is not mangled.
- A newline inside a cell becomes `<br>`. That is the only way GFM expresses a line break inside a cell.
- Cell text is otherwise inserted verbatim. Markdown inside cells stays markdown, because the cell renderer already handles inline markdown and a user pasting `**bold**` from a markdown source wants it bold.

**Ragged rows.** The column count is the widest row. Shorter rows are padded with empty cells so the delimiter row and every body row have the same width. Trailing empty cells from a trailing tab are kept, since they are part of the width the source meant.

**Opting out.** The context menu's **Paste as plain text** inserts the clipboard text unchanged. Today it is a duplicate of **Paste**. This spec is what makes the two differ. `Cmd+Shift+V` is left alone until the shortcut map has a slot for it, and is recorded as a follow-up.

**Undo.** The paste is a single transaction tagged `input.paste`, so `Cmd+Z` removes the whole table and restores the previous state. There is no second "revert to plain text" affordance. If you wanted plain text, undo and use **Paste as plain text**.

**Feedback.** None beyond the rendered table appearing. Conversion is instant and reversible, so a toast would be noise.

## States To Cover

- Empty clipboard: no change, matches today.
- Clipboard is an image: the existing image paste path runs first and wins.
- Clipboard starts with frontmatter: the existing frontmatter paste runs first and wins.
- Tab-separated text, caret on an empty line: table inserted with no padding lines.
- Tab-separated text, caret mid-paragraph: table inserted on its own lines.
- Tab-separated text, caret inside a code fence or inline code: raw text inserted.
- Tab-separated text, caret inside a table cell: raw text inserted. Tabs inside a cell are visible in source mode, which is the honest outcome. Merging pasted rows into an existing table is a future phase.
- Single line with tabs: raw text inserted.
- Multiple lines, one of which has no tab: raw text inserted. A mixed paste is more likely prose with a tab in it than a table with a broken row.
- Quoted multi-line cells from a spreadsheet: one table row with `<br>` inside the cell.
- Cell containing `|`: escaped, renders as a pipe.
- Very large paste, thousands of rows: conversion is linear in the text and runs once. The table widget already virtualises rows, so rendering cost is unchanged from a hand-written table of the same size.

## Implementation Notes

- New pure module `apps/desktop/src/lib/tabular-paste.ts` with two exports: `parseTabularText(text): string[][] | undefined` (detection plus quote-aware TSV parsing, returns `undefined` when the text is not a table) and `toMarkdownTable(rows): string` (escaping, padding, `<br>`, delimiter row). Keeping them pure keeps them testable without an editor.
- One insertion helper in the editor, `insertPastedText(view, text)`, decides between table and raw insert. It checks the syntax tree at the main selection head for `FencedCode`, `InlineCode`, and `TableCell` ancestors. Both the DOM `paste` handler in `use-prosemark-editor.ts` and the context menu `onPaste` call this helper, so there is one write path per `docs/consolidation.md`. `onPastePlain` keeps calling `replaceSelection` directly.
- In the DOM handler, run the table branch after the frontmatter and image checks, and only when `parseTabularText` returns rows. When it does, `event.preventDefault()` and dispatch; otherwise return `false` so CodeMirror's native paste continues unchanged. Not touching the non-table path is the point: a paste that is not a table should behave byte-for-byte as it does now.
- Line-boundary padding is computed from `state.doc.lineAt(from)`: prepend `\n` when the caret is not at the line start, append `\n` when the paste end is not at a line end.
- The cell renderer in `table-decorations.ts` maps `HardBreak` to a `break` node but has no case for an HTML `<br>` tag, so a `<br>` inside a cell would currently render as literal text. Add a case for the `HTMLTag` node that maps `<br>` and `<br/>` (any case, optional whitespace) to `{ type: "break" }` and drops other tags to their text. Without this, multi-line cells from spreadsheets render wrong even though the markdown is correct.
- Tag the dispatch `userEvent: "input.paste"` so undo grouping and any paste-aware extensions treat it like a paste.
- No Rust changes. The clipboard text already reaches the frontend on both paths.

## Files Expected To Change

- new `apps/desktop/src/lib/tabular-paste.ts` — detection, TSV parsing, markdown table serialisation.
- `apps/desktop/src/components/editor-area/use-prosemark-editor.ts` — shared `insertPastedText` helper, used by the DOM paste handler and the context-menu paste.
- `apps/desktop/src/components/editor-area/table-decorations.ts` — `<br>` inside a cell renders as a line break.
- new `apps/desktop/tests/tabular-paste.test.ts` — detection rules, quoting, escaping, padding, `<br>`.
- `apps/desktop/tests/table-decorations.test.ts` — `<br>` cell rendering.
- `docs/keyboard-shortcuts.md` — no new shortcut in v1; note **Paste as plain text** as the opt-out if the doc lists context-menu actions.
- `CHANGELOG.md`, `TODOS.md`.

## Acceptance Criteria

- Pasting the motivating example above on an empty line produces a four-column pipe table whose header is the first row, and it renders in the table widget.
- The same paste with the caret mid-sentence keeps the sentence intact and puts the table on its own lines below it.
- Pasting a two-row Sheets copy where one cell holds two lines produces one table row with a line break inside that cell, and the widget shows it on two lines.
- A cell containing `|` renders as a pipe and does not split the column.
- Pasting tab-separated text inside a code fence inserts it unchanged.
- A single tabbed line, or lines where any line lacks a tab, paste unchanged.
- Context-menu **Paste** converts; **Paste as plain text** does not.
- `Cmd+Z` after a converted paste restores the document to its pre-paste state in one step.
- `vp check` and `vp test` pass with the new tests.

## Follow-Ups

- `Cmd+Shift+V` for paste as plain text, once the shortcut map assigns it.
- Merge pasted rows into an existing table when the caret is in a cell.
- Parse the `text/html` clipboard flavour when present, which would also carry cell formatting.
- CSV behind an explicit "Paste as table" command.

## Change Log

- 2026-09-02 — Created. Scope: tab-separated `text/plain` only, both paste entry points, `<br>` cell rendering fix.
