# User Journeys

Every journey here is something the user relies on working. The QA pass
([qa-checklist.md](./qa-checklist.md), run by the `pensee-qa` skill) walks the
ones a change can reach, and any that fails is fixed before the work is done.

## How to read and extend this file

- One `##` section per feature: a short **Feature** description, the **Spec**,
  the **Code** paths that can break it (relative to `apps/desktop/`; used to
  pick journeys for a change), and a table of journeys.
- **ID** is `AREA-NN` and never reused or renumbered; a removed journey is
  deleted, and its ID stays retired.
- **Check** says how the journey is verified:
  - `auto: <name>` — `e2e/specs/journeys/<name>.spec.js` has an `it("<ID> …")`.
    Run with `apps/desktop/e2e/qa/run.sh --only <ID>,<ID>` (or `<name>` for the whole file).
  - `legacy: <name>` — `e2e/specs/<name>.spec.js` covers it, but on its own
    seed, not the QA vault. Promote it to a journey spec when the area changes.
  - `manual` — no spec yet. Automate it when a change touches its area
    (qa-checklist.md step 3).
  - `you` — needs something an agent can't drive (an outside account, Finder,
    a trackpad gesture). Listed in the QA report for the user to try.
- **★** marks the smoke set: the feature's one journey that must never break.
  Run when the change reaches that feature's Code, or touches a shared file
  (qa-checklist.md step 2); not on every change.
- A new feature adds its section (or rows) in the same commit as the feature.
  Template at the end.

---

## Workspace and windows — WS

**Feature:** Pensée opens on the last workspace (a folder of markdown files),
restores its tabs, and can open more workspaces in their own windows or a single
file in a compact window. When a workspace window first paints, the app icon
settles in on a splash, its ¶ and `PENSÉE` are written, then the splash
dissolves into the app; a click or a key skips to the dissolve.
**Spec:** SPECs/multi-window-spec.md, SPECs/compact-window-spec.md, SPECs/app-entrance-spec.md
**Code:** `src-tauri/src/commands/workspace.rs`, `src-tauri/src/state.rs`, `src/stores/workspace-store.ts`, `src/components/welcome/`, `src/components/compact-file-layout.tsx`, `src/components/app-layout.tsx`, `src/components/app-splash.tsx`, `src/App.css`

| ID    | Journey                                              | Expected                                                                                | Check           |
| ----- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------- |
| WS-01 | ★ Launch the app                                     | The last workspace opens, with the sidebar and its Spaces                               | auto: core      |
| WS-02 | Quit with two notes open, relaunch                   | Both tabs come back, the same one in front                                              | manual          |
| WS-03 | With no workspace, click **Add folder** and pick one | The folder opens as the workspace                                                       | you             |
| WS-04 | Open a single `.md` file from Finder                 | A compact window opens on it: no sidebar, no tab strip                                  | you             |
| WS-05 | Launch the app (Reduce motion off)                   | The icon, its ¶ and `PENSÉE` come in, then the splash is gone and nothing stays applied | auto: workspace |
| WS-06 | Press a key while the splash is writing              | The writing jumps to its end and the splash starts fading at once                       | auto: workspace |

## Sidebar — SB

**Feature:** The sidebar shows the Search field (⌘O), **Today**, **Spaces** (Projects,
Library, Files), Pinned and Recents. **Files** holds the folder tree.
**Spec:** SPECs/spaces-spec.md, SPECs/sidebar-drag-and-drop-move-spec.md
**Code:** `src/components/sidebar/`, `src/components/chrome-tooltip.tsx`, `src/hooks/use-file-tree.ts`, `src-tauri/src/commands/fs.rs`, `src-tauri/src/watcher.rs`

| ID    | Journey                                            | Expected                                                                                                                                                                                                                                                                                                                     | Check      |
| ----- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| SB-01 | ★ Press ⌘[, then ⌘\\                               | The sidebar hides, then shows again                                                                                                                                                                                                                                                                                          | auto: core |
| SB-02 | Click a note under Recents                         | It opens in the active tab                                                                                                                                                                                                                                                                                                   | manual     |
| SB-03 | Click **Files**, expand a folder, click a note     | The tree opens and the note opens                                                                                                                                                                                                                                                                                            | manual     |
| SB-04 | Right-click empty sidebar space → **New file**     | Files opens with a new note to name                                                                                                                                                                                                                                                                                          | manual     |
| SB-05 | Create a note outside Pensée (shell) in the vault  | It appears in Files within a couple of seconds                                                                                                                                                                                                                                                                               | manual     |
| SB-06 | Drag a note onto a folder in Files                 | The file moves on disk; its open tab follows                                                                                                                                                                                                                                                                                 | you        |
| SB-07 | Click the **Search** field at the top              | The command palette opens                                                                                                                                                                                                                                                                                                    | auto: core |
| SB-08 | Hover the sidebar button, top left                 | A tooltip under it reads `Hide sidebar ⌘ [`                                                                                                                                                                                                                                                                                  | auto: core |
| SB-09 | Look at **Spaces** in the sidebar                  | Projects, Library, Files; no Inspirations                                                                                                                                                                                                                                                                                    | auto: core |
| SB-10 | Hover **Today**, then each built-in space          | A tooltip right of the row: `Go to Projects ⌥ P` (Today: `Open today's note ⌘ T`)                                                                                                                                                                                                                                            | auto: core |
| SB-11 | From a note, press ⌘G then P, then ⌘G L, then ⌘G F | While it waits, the sidebar rows show their letters in boxes (T Today, P Projects, L Library, F Files), no hint bar at the bottom; Projects, Library, Files open in turn and no letter is typed into the note; with the sidebar hidden, ⌘G shows a tray at the bottom centre, above the note footer, naming the same letters | auto: core |

## Tabs and columns — TAB

**Feature:** Every open tab is a column side by side; pinch toggles one tab /
all. Tabs have history, shortcuts and a right-click menu.
**Spec:** SPECs/tab-columns-spec.md, SPECs/note-header-menu-spec.md
**Code:** `src/components/editor-area/editor-tabs.tsx`, `src/components/editor-area/tab-columns.tsx`, `src/components/editor-area/tab-columns.css`, `src/components/editor-area/hidden-tab.ts`, `src/components/editor-area/tab-menu.ts`, `src/components/editor-area/heading-level-labels.ts`, `src/components/editor-area/section-rail.tsx`, `src/components/book-reader/book-reader.tsx`, `src/stores/editor-store.ts`, `src/hooks/use-keyboard-shortcuts.ts`, `src/stores/workspace-store.ts`

| ID     | Journey                                                                | Expected                                                                                        | Check               |
| ------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------- |
| TAB-01 | Open two notes in two tabs                                             | Both show as columns side by side                                                               | legacy: tab-columns |
| TAB-02 | ⌘W on the front tab                                                    | It closes; its neighbour takes focus                                                            | manual              |
| TAB-03 | Ctrl+Tab, Ctrl+Shift+Tab, ⌘1…⌘8, ⌘9                                    | Focus moves to the next, previous, Nth tab; ⌘9 the last                                         | manual              |
| TAB-04 | Open two notes in one tab, then ⌥⌘← and ⌥⌘→ with the caret in the note | Goes back to the first note, then forward again                                                 | auto: shortcuts     |
| TAB-05 | Right-click a tab → **Rename**, type, Enter                            | The file is renamed on disk and in the tab                                                      | manual              |
| TAB-06 | Right-click a tab → **Delete**                                         | The note goes to the Trash and its tab closes                                                   | manual              |
| TAB-07 | Pinch in on a tab, then out                                            | One tab fills the window as the fingers start to move, then all columns return; nothing flashes | you                 |
| TAB-08 | ⌘W a note's tab, then ⌘⇧T                                              | The tab comes back where it was, on the same note                                               | auto: shortcuts     |
| TAB-09 | Pinch out a little on a column of a note with headings                 | That tab shows alone at once; each H1–H6 label is beside its heading in the first frame         | auto: tabs          |
| TAB-10 | Pinch in to the columns, then back out and in, fingers down            | Each change of direction switches the layout again                                              | auto: tabs          |
| TAB-11 | Scroll a long note's column, pinch to one tab, then back               | The long note is where you left it, its text laid out                                           | auto: tabs          |
| TAB-12 | Scroll the active column out of view, ⌘O a note                        | The note opens in that column and the strip scrolls it fully into view                          | auto: tabs          |
| TAB-13 | ⌘O, Enter on a recent note open in another column                      | That column becomes active and scrolls fully into view; no tab opens                            | auto: tabs          |
| TAB-14 | Scroll the active column away, ⌘O, pick the note it shows              | The strip scrolls that column back fully into view; no tab opens                                | auto: tabs          |

## Composer (new note) — CMP

**Feature:** ⌘N opens one box to make a note, a line in a day's note, or a
Library item.
**Spec:** SPECs/composer-spec.md
**Code:** `src/components/composer/`, `src/hooks/use-composer.ts`

| ID     | Journey                                                       | Expected                                                                                                                             | Check      |
| ------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| CMP-01 | ★ ⌘N, type a title and text, ⌘↵                               | The note is created with that text and opens                                                                                         | auto: core |
| CMP-02 | ⌘N, type a title, ⌘⇧↵                                         | The note is created, you stay put, a notice offers **Open**                                                                          | auto: core |
| CMP-03 | ⌘P **New Note for Today**, type text with an empty title, ⌘↵  | The text lands at the end of today's note, which opens                                                                               | auto: core |
| CMP-04 | ⌘P **Add to Library…**, paste a YouTube link in the title     | Type switches to Video; creating makes a Library video note                                                                          | manual     |
| CMP-05 | Type something, Esc, ⌘N again                                 | The box reopens with the draft kept                                                                                                  | manual     |
| CMP-06 | ⌘P **New Note for Today**, leave everything empty, ⌘↵         | The button reads **Open today**, with no chevron; today's note opens                                                                 | auto: core |
| CMP-07 | ⌘N, paste a YouTube link, click the chevron beside the button | A menu: **Add video and open it ⌘↵**, **Add video and stay here ⌘⇧↵**; **stay here** makes it, keeps your page and shows **Added …** | auto: core |

## Command palette and search — PAL

**Feature:** ⌘O (also ⌘P and ⌘⇧F, Obsidian's keys) searches files and commands; a pasted link
offers **Add to Library**; content search finds text inside notes.
**Spec:** SPECs/fuzzy-search-grep-spec.md, SPECs/add-to-library-spec.md, SPECs/obsidian-shortcuts-spec.md
**Code:** `src/components/command-palette/`, `src-tauri/src/commands/search.rs`

| ID     | Journey                                          | Expected                                                                                                              | Check         |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------- |
| PAL-01 | ★ ⌘O, type part of a note's name, Enter          | That note opens                                                                                                       | auto: core    |
| PAL-02 | ⌘P, type a command name (e.g. "Toggle Calendar") | The command runs                                                                                                      | manual        |
| PAL-03 | ⌘O, paste a URL                                  | An **Add to Library** row is on top, kind guessed                                                                     | manual        |
| PAL-04 | Search for a word that is only inside a note     | The note is found with the matching line                                                                              | manual        |
| PAL-05 | ⌘P, look at the field, headings and rows         | The field reads _Select a command…_; only commands, each with its key (**Go to Projects ⌘ G P**); no text in all caps | auto: palette |
| PAL-06 | ⌘O, then ⌘⇧F; type a command's name              | Each reads _Find a note…_ and lists notes only, never commands                                                        | auto: palette |

## Editor — ED

**Feature:** The markdown editor: title row, folded properties, live-rendered
markdown, formatting shortcuts, lists and tasks, find and replace, autosave.
**Spec:** SPECs/page-title-spec.md, SPECs/cmd-f-spec.md, SPECs/multilevel-list-numbering-spec.md, SPECs/editor-audit-spec.md, SPECs/list-tree-rail-spec.md, SPECs/section-indicators-spec.md
**Code:** `src/components/editor-area/`, `src/lib/prosemark-core/`, `src/hooks/editor-api.ts`, `src-tauri/src/commands/fs.rs` (write_file)

| ID    | Journey                                                                                               | Expected                                                                                                                                                                                                                                                                  | Check                       |
| ----- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| ED-01 | ★ Open a note, type a sentence                                                                        | It is saved to disk within a second; no unsaved dot remains                                                                                                                                                                                                               | auto: core                  |
| ED-02 | ★ Click the title, rename, Enter                                                                      | The file is renamed; the caret moves to the body                                                                                                                                                                                                                          | auto: core                  |
| ED-03 | Click **N properties ›** under the title                                                              | The properties open; clicking again folds them                                                                                                                                                                                                                            | auto: editor                |
| ED-04 | ⌘B, ⌘I, ⌘K on selected text; then ⌘E                                                                  | Bold, italic, link markup is applied and rendered; ⌘E does nothing                                                                                                                                                                                                        | manual                      |
| ED-05 | Type `- a`, Enter, Tab, `b`                                                                           | A nested bullet; Shift+Tab lifts it back                                                                                                                                                                                                                                  | manual                      |
| ED-06 | Type `1. a`, Enter, Tab                                                                               | Nested numbering reads `1.1` style, like a word processor                                                                                                                                                                                                                 | manual                      |
| ED-07 | Click a task checkbox                                                                                 | It toggles `[ ]` ↔ `[x]` in the file                                                                                                                                                                                                                                      | manual                      |
| ED-08 | ⌘⌥1 … ⌘⌥6, then ⌘⌥0                                                                                   | The line becomes H1…H6, then plain paragraph                                                                                                                                                                                                                              | legacy: empty-heading-enter |
| ED-09 | ⌥⌘F, type a word, Enter; replace one, then **All**                                                    | Find opens with Replace; matches highlight and step; replacements are written                                                                                                                                                                                             | manual                      |
| ED-10 | Triple-click a paragraph; double-click a bullet's marker                                              | Selection stops at the text's end with a ¶; marker excluded                                                                                                                                                                                                               | manual                      |
| ED-11 | ⌘Z, ⌘⇧Z after typing                                                                                  | Undo and redo the edit; history does not leak across files                                                                                                                                                                                                                | manual                      |
| ED-12 | Change an open note on disk from the shell                                                            | The editor shows the new text without losing the tab                                                                                                                                                                                                                      | manual                      |
| ED-13 | Click an unchecked task, then click it again                                                          | Box pops, tick draws in, six dots burst once; uncheck is still                                                                                                                                                                                                            | auto: editor                |
| ED-14 | Type a nested bullet; hover its parent, then the nested one                                           | A faint straight guide drops from the parent; hovering the parent darkens it, hovering the nested (childless) one clears it                                                                                                                                               | auto: lists                 |
| ED-15 | Under a nested bullet, type an unindented line, then more nested bullets                              | No guide crosses the line: the guide stops above it and starts again below for the bullets after it                                                                                                                                                                       | auto: lists                 |
| ED-16 | In a note, ⌘F, Esc, then ⌘⇧F                                                                          | The note's find bar opens (no Replace row) and closes; then search opens, with no find bar                                                                                                                                                                                | auto: editor                |
| ED-17 | In a note, ⌥⌘F                                                                                        | The note's find bar opens with the Replace row                                                                                                                                                                                                                            | auto: editor                |
| ED-18 | On a plain line, ⌘L three times                                                                       | `- [ ] line`, then `- [x] line`, then `- [ ] line` in the file                                                                                                                                                                                                            | auto: shortcuts             |
| ED-19 | ⌘D on a line                                                                                          | The line is deleted; the lines around it stay                                                                                                                                                                                                                             | auto: shortcuts             |
| ED-20 | Open a note with headings where the page has room on its right                                        | **On this page** lists every heading beside the page, indented by level; the one in view is marked on the line; no ticks                                                                                                                                                  | auto: outline               |
| ED-21 | Click a heading under **On this page**                                                                | The note scrolls to that heading                                                                                                                                                                                                                                          | auto: outline               |
| ED-22 | Narrow the room on the right (smaller window, wider page, side by side)                               | The list folds back into ticks; hovering them still opens the heading list                                                                                                                                                                                                | auto: outline               |
| ED-23 | Scroll with the trackpad while the pointer is over **On this page**                                   | The note scrolls, as over the empty margin; the list follows the mark                                                                                                                                                                                                     | auto: outline               |
| ED-24 | Scroll through a long note with **On this page** showing; click a far heading; scroll to the very end | The mark moves to a heading once it passes the middle of the screen, so it is on the section filling most of the view; a clicked heading stays marked until you scroll or type, even when its section is short; at the end of the note the last heading in view is marked | you                         |
| ED-25 | Open a video note with headings, room on the right; scroll it                                         | **On this page** starts under the video and its transcript, beside the text, and rides up with them as they pin to the top; it never covers the transcript, which still scrolls                                                                                           | auto: outline               |
| ED-26 | In a long note, ⌘↓, type, then ⌘↑                                                                     | ⌘↓ scrolls to the very bottom of the page and the words land at the note's end; ⌘↑ scrolls back to the very top, the title showing                                                                                                                                        | auto: editor                |

## Links — LNK

**Feature:** `[[wiki links]]` with autocomplete and page creation, hover
previews, heading anchors, `@` date mentions, inline URL icons and full-page
link previews.
**Spec:** SPECs/wiki-link-pages-spec.md, SPECs/wiki-link-preview-spec.md, SPECs/heading-anchor-links-spec.md, SPECs/link-preview-spec.md
**Code:** `src/components/editor-area/` (link-navigation.ts, link-preview.ts, wiki-link-\*.ts, wiki-pages-extension.ts, date-mention.ts), `src/lib/prosemark-core/links.ts`

| ID     | Journey                                       | Expected                                                   | Check           |
| ------ | --------------------------------------------- | ---------------------------------------------------------- | --------------- |
| LNK-01 | ★ Click a `[[Welcome]]` link in a note        | Welcome opens in a new column beside the note              | auto: core      |
| LNK-02 | In a bullet, type `[[Wel`, Enter              | `[[Welcome]]` is inserted on that line; no new bullet      | auto: shortcuts |
| LNK-08 | Type `[[Brand new page]]` and click it        | The page is created (empty) and opens beside               | manual          |
| LNK-03 | Hover a `[[link]]`                            | A preview card of the page shows beside it                 | manual          |
| LNK-04 | Type `@to`, Enter                             | `[[YYYY-MM-DD]]` for today is inserted; it opens that note | auto: shortcuts |
| LNK-05 | Click `[See](#section)`                       | The editor scrolls to that heading                         | manual          |
| LNK-06 | Paste a URL on its own line                   | The page shows live in a frame with reload / open buttons  | manual          |
| LNK-09 | Put the caret on a `[[Welcome]]` link, ⌥Enter | Welcome opens beside, as a click does                      | auto: shortcuts |
| LNK-07 | A URL mid-sentence                            | Shows as a link icon; click opens the browser              | manual          |

## Blocks — BLK

**Feature:** Each block has a handle menu (turn into, move, duplicate,
delete). A list item's move, duplicate, cut, copy and delete take its nested
items with it, and numbers stay in sequence. With several list items selected,
every action in the menu takes all of them. Blocks can be linked into other
notes and edited in either place.
**Spec:** SPECs/block-handle-menu-spec.md, SPECs/block-embed-spec.md
**Code:** `src/components/editor-area/` (block-handle-menu.ts, block-actions.ts, block-embed.ts, linked-block-sync.ts, block-backlinks.ts)

| ID     | Journey                                                                               | Expected                                                                                                                                                   | Check        |
| ------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| BLK-01 | Hover a paragraph, open its ¶ handle, choose **Heading 2**                            | Only that block becomes `## `                                                                                                                              | auto: blocks |
| BLK-02 | Handle menu on a list item → **Move down**, **Delete**                                | Only that item moves / goes; numbers stay in order                                                                                                         | auto: blocks |
| BLK-03 | ⌘⇧C in a paragraph, ⌘⇧V in another note                                               | A linked block appears; editing it changes the original note                                                                                               | manual       |
| BLK-04 | Select text, ⌘⌥N, pick a page                                                         | The text moves into that page and a link is left behind                                                                                                    | manual       |
| BLK-05 | Select several bullets, open one item's handle → **Numbered list**                    | Every selected item is numbered 1, 2, 3…; items outside the selection keep their marker                                                                    | auto: blocks |
| BLK-06 | Handle menu on a numbered item with nested items → **Delete**, ⌘Z, then **Duplicate** | Delete takes the item and its nested items, and the numbers close up; ⌘Z brings both back; the copy lands below the nested items, with them, numbered next | auto: blocks |
| BLK-07 | Select three of four bullets, open one selected item's handle → **Delete**, then ⌘Z   | No **Copy link to block** row; all three go and the fourth stays; one ⌘Z brings all three back                                                             | auto: blocks |

## Rich content — MED

**Feature:** Images, videos and HTML files embed inline; tables render and edit
in place; LaTeX math and Mermaid diagrams render (Pele, drawn in Arc's style;
charts as Arc charts).
**Spec:** SPECs/obsidian-image-embed-spec.md, SPECs/table-in-place-cell-editing-spec.md, SPECs/paste-tabular-data-as-table-spec.md, SPECs/latex-math-spec.md, SPECs/mermaid-canvas-widget-spec.md, SPECs/html-file-embed-spec.md, SPECs/talk-notes-spec.md
**Code:** `src/components/editor-area/` (image-src-resolver.ts, table-decorations.ts, mermaid-_.ts, pele-chart\*.ts(x), math-_.ts, html-\*.ts, video-embed-widget.ts, columns-decorations.ts (fileDropPlugin)), `src/components/arc/` (donut-chart, bar-chart, line-chart, treemap, tree-view, sankey-flow, radar-chart), `src/lib/paths.ts` (embedTargetFor), `src-tauri/src/commands/images.rs`

| ID     | Journey                                               | Expected                                                                                                                                                                                   | Check                   |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| MED-01 | Paste an image into a note                            | It is saved to the note's assets folder and shows inline                                                                                                                                   | manual                  |
| MED-02 | `![[clip.mp4]]` in a note                             | A video player shows                                                                                                                                                                       | manual                  |
| MED-03 | Click a cell in a rendered table and type             | The cell edits in place; the table stays rendered                                                                                                                                          | legacy: table-cell-edit |
| MED-04 | Paste tab-separated rows                              | A markdown table is inserted                                                                                                                                                               | manual                  |
| MED-05 | `$x^2$` and a `$$` block                              | Both render as math                                                                                                                                                                        | legacy: latex-math      |
| MED-06 | A ```mermaid flowchart                                | Pele draws it in Arc's style (hairline-ringed shapes) in a canvas with pan, zoom, reset, fullscreen and the source toggle                                                                  | auto: media             |
| MED-07 | Drop an `.html` file from Finder onto a note          | `![[page.html]]` lands where you let go (workspace-relative, or note-relative from outside) and the page shows framed; the file is not copied                                              | you                     |
| MED-08 | ★ Press **Expand** on an embedded HTML page, then Esc | The page grows over its note in place, filling the note's area, without reloading; the text around it stays put; Esc (or **Shrink back**) puts it back where it was; the file is unchanged | auto: media             |
| MED-09 | A ```mermaid pie                                      | An Arc donut chart shows each slice and its value in the frame; the source toggle and fullscreen stay, the zoom buttons go                                                                 | auto: media             |
| MED-10 | A ```mermaid block with a mistake                     | The frame shows Pele's message ("Diagram error: …") instead of a picture                                                                                                                   | auto: media             |

## Calendar panel — CAL

**Feature:** ⌘] opens a calendar on the right. Clicking a day, week, month,
quarter or year creates or opens its note (`2026-10-13`, `2026-W42`, `2026-10`,
`2026-Q4`, `2026`) in the daily-note folder; a dot marks notes that exist.
**Spec:** SPECs/calendar-panel-spec.md
**Code:** `src/components/calendar-panel/`, `src/components/chrome-tooltip.tsx`, `src/components/arc/calendar/`, `src/lib/periodic-notes.ts`, `src/lib/daily-note.ts`, `src/hooks/use-daily-note.ts`, `src/hooks/use-calendar-panel.ts`, `src-tauri/src/commands/fs.rs` (list_markdown_stems, create_file_if_missing)

| ID     | Journey                                                 | Expected                                                    | Check          |
| ------ | ------------------------------------------------------- | ----------------------------------------------------------- | -------------- |
| CAL-01 | ★ ⌘], then the panel button                             | The panel opens, then closes                                | auto: calendar |
| CAL-02 | ★ Click a day                                           | Its note is created (or opened) and is in front; day filled | auto: calendar |
| CAL-03 | Click a week number (W42)                               | The week's note opens                                       | auto: calendar |
| CAL-04 | Title menu → **Months**; click a month, then **Q4**     | The month's, then the quarter's note opens                  | auto: calendar |
| CAL-05 | Title menu → **Years**; click this year                 | The year's note opens                                       | auto: calendar |
| CAL-06 | **Today** after notes exist                             | Back on this month; days with a note show a dot             | auto: calendar |
| CAL-07 | ⌘-click a day                                           | The note opens in a new column right of the active tab      | auto: calendar |
| CAL-08 | In a large iCloud vault, open the panel and click a day | Dots appear at once; the note opens within a second         | you            |
| CAL-09 | Hover the calendar button, top right                    | A tooltip under it reads `Show calendar ⌘ ]`                | auto: core     |

## Daily note — DN

**Feature:** Today's note, named `YYYY-MM-DD`, lives in the Daily Note Folder
setting (workspace root when blank) and is reached from ⌘T, the sidebar's
**Today** (which shows `⌘T` on hover), the composer, the palette and the calendar.
**Spec:** SPECs/daily-note-spec.md
**Code:** `src/lib/daily-note.ts`, `src/hooks/use-daily-note.ts`, `src/components/sidebar/` (Today)

| ID    | Journey                                              | Expected                                           | Check      |
| ----- | ---------------------------------------------------- | -------------------------------------------------- | ---------- |
| DN-01 | ★ Click **Today** in the sidebar                     | Today's note is created if missing and opens       | auto: core |
| DN-02 | ⌘P → **Open Today's Note** twice                     | The same note opens; its text is never overwritten | manual     |
| DN-03 | Set Daily Note Folder to `Journal/Daily`, open today | The note is created in that folder                 | manual     |
| DN-04 | ★ From another note, press ⌘T                        | Today's note is created if missing and opens       | auto: core |
| DN-05 | Hover **Today** in the sidebar                       | `⌘T` shows at the row's right end                  | you        |

## Boards — BRD

**Feature:** `.board.svg` whiteboards shown in notes: shapes, connectors, pen,
flowcharts, find, present, PNG export. Sections group cards: their name is
renamed in place, they take a colour, and dragging one carries what sits in it.
Sticky notes and mind maps already on a board still show and edit; new ones
can no longer be added.
Opened full screen or **Edit here** over a note.
**Spec:** SPECs/board-lark-parity-spec.md, SPECs/board-rich-text-spec.md, SPECs/board-color-palette-spec.md, SPECs/board-docking-glow-spec.md
**Code:** `src/components/editor-area/board/`

| ID     | Journey                                        | Expected                                                                                                                                                                                         | Check                   |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| BRD-01 | `/board` in a note, pick Blank                 | A `.board.svg` is created next to the note and opens                                                                                                                                             | legacy: board-file      |
| BRD-02 | Open a board holding a sticky note, close it   | The preview in the note shows the sticky                                                                                                                                                         | legacy: board-file      |
| BRD-03 | Select a shape, click its blue dot             | A connected shape is added with an arrow                                                                                                                                                         | legacy: board-flowchart |
| BRD-04 | ⌘Z, ⌘⇧Z on the board                           | Undo and redo work on the board, not the note behind it                                                                                                                                          | manual                  |
| BRD-05 | Hover the board in a note → **Edit here**, Esc | Opens over that note's column only; Esc returns to it                                                                                                                                            | manual                  |
| BRD-06 | Export PNG; **Present**                        | A PNG is saved; present mode steps through frames                                                                                                                                                | manual                  |
| BRD-07 | Drag a card near another, hold, let go         | Held: the card's imprint in its slot after the other, the arrow it will get lit, the other card glowing with a port; dropped: the card sits in that slot, joined by an arrow that is in the file | auto: board             |
| BRD-08 | Look over a board's tools; press N, then M     | No Sticky note or Mind map tool; N and M pick nothing (T still picks Text)                                                                                                                       | auto: board             |
| BRD-09 | Double-click a section's name, type, Enter     | A field opens on the name, holding it; Enter closes it, the section reads the new name and the file has it                                                                                       | auto: board             |
| BRD-10 | Select a section → **Section colour** → Green  | The section turns a thin green with a green edge and name; the file has `"c":"green-soft"` on it                                                                                                 | auto: board             |
| BRD-11 | ★ Drag a section by its name                   | Everything inside it moves with it, cards made before the section too; a card outside stays put; the file has the cards' new places                                                              | auto: board             |

## Projects — PRJ

**Feature:** The Projects space is a kanban of `Type: Project` notes by
**Status**. Moving a card writes the note's frontmatter. Done folds its older cards.
Select sentences in any note, right-click, **Add to Projects**: Claude makes a
project of each one that takes more than two steps, keeping names you wrote.
**Spec:** SPECs/project-views-spec.md, SPECs/add-to-projects-spec.md
**Code:** `src/components/spaces/project-views.tsx`, `src/components/arc/blocks/kanban-board/`, `src/lib/projects.ts`, `src/lib/project-template.ts`, `src/hooks/use-spaces.ts` (createProjectNote, adoptProjectNote, findNoteNamed), `src/lib/projects-from-text.ts`, `src/components/editor-area/add-to-projects.ts`, `src/components/add-to-projects/`, `src/components/editor-area/editor-context-menu.ts`, `src/components/editor-area/editor-body-menu.ts`, `src-tauri/src/commands/spaces.rs`, `src-tauri/src/file_cache.rs`, `src-tauri/src/commands/fs.rs` (write_file), `src-tauri/src/watcher.rs` (index_written_file)

| ID     | Journey                                                                                                                                    | Expected                                                                                                                                                                                                                                                                                                                       | Check               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| PRJ-01 | ★ Click **Projects** in the sidebar                                                                                                        | The kanban shows Launch site and Old idea                                                                                                                                                                                                                                                                                      | auto: core          |
| PRJ-02 | Drag a card to another column                                                                                                              | Its note's `Status:` changes on disk                                                                                                                                                                                                                                                                                           | you                 |
| PRJ-03 | Focus a card, Space, →, Space                                                                                                              | The card moves one column; Status is written                                                                                                                                                                                                                                                                                   | manual              |
| PRJ-04 | **+** on a column, type a new name, Enter                                                                                                  | A project note is created with that Status and shows                                                                                                                                                                                                                                                                           | legacy: project-add |
| PRJ-05 | Click a card                                                                                                                               | Its note opens; **Back** returns to Projects                                                                                                                                                                                                                                                                                   | manual              |
| PRJ-06 | Done holds more cards than fit                                                                                                             | **Show N more** unfolds them, **Show fewer** folds                                                                                                                                                                                                                                                                             | manual              |
| PRJ-07 | Select three sentences, each a plan of three steps or more, plus "Call Sam."; right-click                                                  | **Add to Projects** is the first item; picking it shows **Adding to Projects…**, then a project note per plan in **No status**, each holding its sentence, a name already written (`**Garden**:`, `[[Trip]]`) kept; none for "Call Sam."; the notice names them, says 1 sentence isn't a project, and offers **Open Projects** | you                 |
| PRJ-08 | Select a heading and the bullets under it that are its steps ("Japan trip": book flights, a hotel, a rail pass); **Add to Projects**       | One project holding all of them, the steps as a list                                                                                                                                                                                                                                                                           | you                 |
| PRJ-09 | Right-click in a note with nothing selected                                                                                                | No **Add to Projects** in the menu                                                                                                                                                                                                                                                                                             | you                 |
| PRJ-10 | With Projects open, a project note with an empty `Status:` is written by the app (as Add to Projects writes one)                           | It shows on the board in **No status** within a few seconds, without a restart                                                                                                                                                                                                                                                 | auto: projects      |
| PRJ-11 | Select three bullets: a one page website, a Discord channel to get people posting, an email for customer questions; **Add to Projects**    | Three projects in No status, one per bullet. Run it again: **Already a project?** shows each line that looks like a project you have beside that project's card; **Same project** makes nothing, **New project** makes its own, Esc makes nothing                                                                              | you                 |
| PRJ-12 | With a Templater project template in the vault (sections, a Dataview query, its own properties): **+** on a column, type a new name, Enter | The note is made in the template's folder holding only `Type: Project` and the column's `Status`: none of the template's properties, headings or queries                                                                                                                                                                       | auto: projects      |

## Library — LIB

**Feature:** Books, videos (courses among them), podcasts and papers as a cover
gallery with type tabs; items are added from a link, a file or a title.
**Spec:** SPECs/add-to-library-spec.md, SPECs/spaces-spec.md
**Code:** `src/components/spaces/note-gallery.tsx`, `src/components/spaces/space-page.tsx`, `src/components/spaces/space-cover.tsx`, `src/lib/covers.ts`, `src/lib/library-add.ts`, `src/lib/book-library.ts`, `src/lib/book-import.ts` (openBookBesideOpenPage, openLinkedBookBesideOpenPage), `src/lib/wiki-links.ts` (firstBookLinkTarget), `src/hooks/use-library-add.ts`, `src/hooks/use-composer.ts` (the Added notice's Open), `src-tauri/src/commands/web_pdf.rs`, `src-tauri/src/commands/link_preview.rs` (pdf), `src-tauri/src/commands/spaces.rs`, `src-tauri/src/file_cache.rs`, `src-tauri/src/commands/covers.rs`

| ID     | Journey                                                     | Expected                                                                                                                       | Check                  |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| LIB-01 | ★ Click **Library**                                         | The seeded book shows under Books                                                                                              | auto: core             |
| LIB-05 | Switch Library tabs (Books, Videos, …)                      | Covers show; switching is instant                                                                                              | legacy: library-covers |
| LIB-02 | Click a book cover                                          | Its note opens (beside its book file when there is one)                                                                        | manual                 |
| LIB-03 | **+** at the top, paste a YouTube link                      | A video note named after the video is created and opens                                                                        | you                    |
| LIB-06 | Library → Podcasts, a podcast with a YouTube link           | Its cover is the video's thumbnail                                                                                             | you                    |
| LIB-07 | Library → Papers, click a paper whose note embeds a PDF     | Its note opens, and the PDF opens in the reader beside it                                                                      | auto: library          |
| LIB-08 | ⌘N, paste a link to a PDF, ⌘↵                               | A `Type: Paper` note opens with the PDF saved in its assets and embedded at the top, and the PDF opens in the reader beside it | auto: library          |
| LIB-09 | ⌘N, paste an arXiv abstract link, ⌘⇧↵                       | The note is named by the paper's title, and its PDF opens in the reader beside it                                              | you                    |
| LIB-10 | ⌘N, paste a link to a PDF, ⌘⇧↵, then **Open** on the notice | The paper's note opens with its PDF in the reader beside it                                                                    | auto: library          |

## Book reader — BK

**Feature:** PDFs and EPUBs open beside their book note; highlights become
bullets that end in a pin leading back to the passage; text size and reading
place persist.
**Spec:** SPECs/book-reader-spec.md
**Code:** `src/components/book-reader/`, `src/lib/book-*.ts`, `src-tauri/src/commands/books.rs`

| ID    | Journey                                                      | Expected                                                                                                                       | Check                  |
| ----- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| BK-01 | Drop an EPUB on the window                                   | It is saved by its note and opens beside it                                                                                    | you                    |
| BK-02 | Select text in the book → **Highlight**                      | A bullet with the passage is added to the note                                                                                 | manual                 |
| BK-03 | Close and reopen the book                                    | It opens on the same passage                                                                                                   | legacy: book-place     |
| BK-04 | **Aa** → large A                                             | Text grows; the passage stays in view; the size persists                                                                       | legacy: book-text-size |
| BK-05 | Open a book's note, hover a highlight bullet's pin, click it | The bullet ends in a pin, not its `^bk-` id; the tooltip names the page or chapter; the book opens beside the note (if closed) | auto: library          |
| BK-06 | Click a highlight bullet's pin with its book open            | The book scrolls to the passage, which flashes                                                                                 | you                    |

## YouTube notes — YT

**Feature:** A note with a YouTube link plays the video under its properties,
pins moments to lines and fetches the transcript (English by default, other
caption languages from a menu), which shows as a teleprompter box that
highlights the line being said, seeks, copies, folds and asks the Agent:
beside the video and pinned with it in a wide pane, under it in a narrow one.
**Spec:** SPECs/youtube-notes-spec.md
**Code:** `src/components/editor-area/` (video-player.tsx, video-player.css, video-pin.ts, player-keys.tsx, video-transcript.ts, transcript-box.tsx, transcript-box.css, transcript-view.ts, html-block-decorations.ts, transcript-edges.ts), `src/lib/video-transcript.ts`, `src/lib/video-players.ts`, `src/lib/covers.ts` (youtubeStartSeconds), `src/hooks/use-composer.ts` (a link already in Library), `src/components/command-palette/library-add-rows.tsx`, `src/components/arc/dropdown-menu/`, `src/stores/agent-store.ts` (open), `src-tauri/src/commands/video_player.rs`, `src-tauri/src/commands/youtube-player.html`

| ID    | Journey                                                                                         | Expected                                                                                                                                                                                   | Check                     |
| ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| YT-01 | Open a note with a YouTube `Link:`                                                              | The player shows under the properties                                                                                                                                                      | legacy: youtube-notes     |
| YT-02 | Play, ⌘S on a line                                                                              | The line gets a pin; clicking it seeks to that moment                                                                                                                                      | legacy: youtube-pin-click |
| YT-03 | ⌘S in a video's note while it plays, then ⌘S again                                              | The line gets a pin and the video pauses; the second ⌘S plays on                                                                                                                           | manual                    |
| YT-04 | ★ Open a video note with a transcript                                                           | A box shows the transcript a sentence a line, the first line in ink; no `<summary>` or `<p>` HTML in the note                                                                              | auto: youtube             |
| YT-05 | Click a line in the transcript box                                                              | That line becomes the one being said, its time (`1:00`) shows, the video plays from it; the box stays a box                                                                                | auto: youtube             |
| YT-06 | Scroll the box (wheel, trackpad or scrollbar)                                                   | **Back to now** appears; clicking it hides it and the box follows the video again                                                                                                          | auto: youtube             |
| YT-07 | **Copy** in the transcript box                                                                  | It reads **Copied**; the clipboard holds every paragraph after its time (`0:00 …`, blank line, `1:00 …`)                                                                                   | auto: youtube             |
| YT-08 | **Ask** in the transcript box                                                                   | The Agent panel opens with its input focused                                                                                                                                               | auto: youtube             |
| YT-09 | Play, then ask the Agent "what did they just say?"                                              | The answer is about the lines around the video's time                                                                                                                                      | you                       |
| YT-10 | ★ Open a video note and type straight away                                                      | The words show on a line of their own under the box, after a blank line; the `<details>` lines stay intact                                                                                 | auto: youtube             |
| YT-11 | Watch the transcript box follow the video                                                       | The line being said is highlighted (a soft band, full ink), its words shown at once, not revealed word by word                                                                             | auto: youtube             |
| YT-12 | Fold the box from its header, reopen the note                                                   | Only the header stays, under the video; the note opens folded again; unfolding in a wide pane puts it beside                                                                               | auto: youtube             |
| YT-13 | ★ Open a video note in a wide pane, scroll; narrow it                                           | Wide: the box is right of the video, as tall as it, and stays at the top with it; narrow: it is under the video                                                                            | auto: youtube             |
| YT-14 | Pick another language in the box's language menu                                                | The menu lists the video's caption languages, English first; the toggle is read again in it (`lang` kept), the rest of the note untouched                                                  | auto: youtube (YouTube)   |
| YT-15 | Add a video whose speech isn't English                                                          | The transcript comes in English when the video has English captions; the menu offers the others                                                                                            | you                       |
| YT-16 | Open an older video note with no captions                                                       | No **Transcript** button under the video, only the keys row                                                                                                                                | you                       |
| YT-17 | ⌘S in a video note, then ⌘S in a plain note                                                     | The video note's line gets a pin; in the plain note nothing happens                                                                                                                        | auto: podcast (POD-05)    |
| YT-18 | Paste a Coursera link into Library's **+**                                                      | It is guessed as a Video; Library has no Courses tab, `Type: Course` notes show under Videos                                                                                               | you                       |
| YT-19 | Look at the row under the video                                                                 | It starts with the keys in full, then **Transcript** on the same line: **Play ⌘S** while paused (**Pin ⌘S** while playing), **Slower ⇧,**, **Faster ⇧.**; there are no Play or Pin buttons | auto: youtube             |
| YT-20 | Over the video press ← / →; off it, press →                                                     | Over the video each press skips it 5s back or on and the caret stays put; off it, → moves the caret                                                                                        | auto: youtube             |
| YT-21 | Hover the track of a video with chapters, rest 3s                                               | The line thickens, the chapter there more, a knob marks the playhead; the tooltip names the whole chapter and the time; the bar stays up                                                   | you                       |
| YT-22 | Open a note whose link ends in `t=210`, press Play                                              | The video plays from 3:30, as the link does on YouTube (`t=3m30s`, `#t=` and an embed's `start=` too)                                                                                      | auto: youtube (YouTube)   |
| YT-23 | ⌘N, paste a link with `t=95` to a video already in Library, ⌘↵                                  | Its note opens and the video plays from 1:35                                                                                                                                               | auto: youtube (YouTube)   |
| YT-24 | ⌘O, paste a link with `t=2m30s` to a video already in Library, pick **Already in your Library** | Its note opens and the video plays from 2:30                                                                                                                                               | auto: youtube (YouTube)   |
| YT-25 | In the video's note press ⇧. off the video, then over it                                        | Off it `>` is typed and the speed stays; over it the speed steps up and nothing is typed                                                                                                   | auto: youtube (YouTube)   |
| YT-26 | Click the video, move the pointer off it, press →                                               | The caret moves; the video doesn't skip                                                                                                                                                    | you                       |

## Podcast notes — POD

**Feature:** A podcast note plays its episode in a card under its properties
(artwork, title and show, skips, timeline, speed, volume, Pin); adding a
podcast opens the note, and ⌘S plays, pins and pauses as on a video.
**Spec:** SPECs/podcast-notes-spec.md
**Code:** `src/components/editor-area/podcast-player.tsx`, `src/components/editor-area/podcast-player.css`, `src/components/editor-area/player-keys.tsx`, `src/lib/podcast-player.ts`, `src/lib/video-players.ts`, `src/components/editor-area/video-pin.ts`, `src/hooks/use-composer.ts`, `src-tauri/src/commands/podcasts.rs`

| ID     | Journey                                                                            | Expected                                                                                                                                                                                                                     | Check         |
| ------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| POD-01 | Library → Podcasts → **+**, paste a link, ⌘↵                                       | The note opens with the player, paused                                                                                                                                                                                       | auto: podcast |
| POD-02 | ★ ⌘S on a line, then ⌘S again                                                      | It plays; the second ⌘S pins the line at that moment and pauses                                                                                                                                                              | auto: podcast |
| POD-03 | Add an Apple Podcasts or Spotify episode link                                      | The player finds the episode and plays the whole episode, with its artwork, title and show                                                                                                                                   | you           |
| POD-04 | Add an episode's page link; Back 15                                                | The card shows the page's whole artwork (blurred fill around it), title and show, no Pin button, and under the card (outside it) the keys in full (Play ⌘S while paused, Slower ⇧,, Faster ⇧.); the playhead moves back 15 s | auto: podcast |
| POD-05 | ⌘S in a plain note while a podcast is mounted                                      | No pin is drawn or written anywhere                                                                                                                                                                                          | auto: podcast |
| POD-06 | In the note ⇧. off the player; then over it ⇧. and ⇧,, also with Pinyin on (《 》) | Off the player `>` is typed and the speed stays; over it the episode speeds up, then slows down, and nothing is typed                                                                                                        | auto: podcast |

## Agent chat — AG

**Feature:** ⌘J opens a Claude chat bottom right that reads the open tabs and
period notes and edits files.
**Spec:** SPECs/agent-chat-spec.md
**Code:** `src/components/agent-chat/`, `src/lib/agent-*.ts`, `src-tauri/src/commands/agent.rs`

| ID    | Journey                            | Expected                                         | Check |
| ----- | ---------------------------------- | ------------------------------------------------ | ----- |
| AG-01 | ⌘J, ask "what is this page about?" | An answer about the front tab arrives in seconds | you   |
| AG-02 | Ask it to add a line to the note   | The file changes and the editor updates in place | you   |

## Settings and appearance — SET

**Feature:** Preferences (⌘,) for accent colour, light/dark colours, fonts,
editor size and width, daily-note folder, sidebar and status-bar visibility.
The page width can also be set from the status bar: Readable, Wide or Full.
Window zoom with ⌘= / ⌘- / ⌘0.
**Spec:** SPECs/global-font-settings-spec.md, SPECs/editor-content-width-spec.md, SPECs/window-zoom-spec.md, SPECs/statusbar-sidebar-visibility-spec.md
**Code:** `src/components/settings-panel/`, `src/stores/settings-store.ts`, `src/styles/tokens.css`, `src-tauri/src/commands/settings.rs`, `shared/settings.schema.json`, `src/components/editor-area/page-width-presets.tsx`, `src/components/editor-area/document-footer.tsx`, `src/components/editor-area/footer-context-menu.ts`

| ID     | Journey                                                        | Expected                                                                                        | Check                       |
| ------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------- |
| SET-01 | ★ ⌘P → **Settings** (or ⌘,)                                    | Preferences opens in a tab                                                                      | auto: core                  |
| SET-02 | Pick another **Accent**                                        | Selection, focus ring, calendar day take the colour                                             | manual                      |
| SET-03 | Change editor font                                             | The editor text changes at once and after relaunch                                              | legacy: font-picker         |
| SET-04 | ⌘=, ⌘-, ⌘0                                                     | The window zooms in, out, back to 100%; persists                                                | legacy: window-zoom         |
| SET-05 | Right-click the status bar, hide a metric                      | It hides and stays hidden after relaunch                                                        | legacy: visibility-settings |
| SET-06 | Click **Wide**, **Full width**, **Readable** in the status bar | The text column widens, widens again, then returns to 660; Content Width is saved as each value | auto: settings              |
| SET-07 | Right-click the status bar, untick **Page Width**              | The width presets hide and stay hidden after relaunch                                           | you                         |

## Imports — IMP

**Feature:** Apple Books highlights sync into notes in the background.
**Spec:** SPECs/apple-books-highlights-spec.md
**Code:** `src/lib/apple-books.ts`, `src/hooks/use-apple-books-sync.ts`, `src/components/full-disk-access-guide/`, `src/stores/full-disk-access-store.ts`, `src-tauri/src/commands/apple_books.rs`

| ID     | Journey                                                    | Expected                                                                                                                                                                                      | Check         |
| ------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| IMP-01 | Settings → Apple Books → Import Highlights                 | Highlighted books get pages with bullets                                                                                                                                                      | you           |
| IMP-03 | Import Highlights on without Full Disk Access              | No macOS "data from other apps" prompt; the Full Disk Access guide opens on a System Settings screenshot: markers 1–3 on +, Pensée (joined the list) and its switch (drawn on); Esc closes it | auto: imports |
| IMP-04 | In the guide, **Open Settings**, turn Pensée on, come back | Privacy & Security → Full Disk Access opens; back in Pensée the guide reads _Full Disk Access is on_ and highlights import                                                                    | you           |

## Second pen — PEN

**Feature:** Press ⌘. on a line and pick what the pen does; it writes in blue
ink right under the line and never writes your conclusion. `!` writes an
answer **sealed**, your take beside it, until you've written that take (a take
that isn't one keeps it sealed); it then opens with nothing else moving, so you
can read both, and **Combine** (Tab) turns the two into one MECE tree of
short points, yours in your own words and the pen's only where they add
something (never your take again), a point's parts and details nested under
it (two levels at most) whoever wrote either. Undo puts
the two back. `@` writes two lines from papers,
labelled for what the line asks: **For** and **Against** on a claim, **How** and
**Caveat** on a how-to, and so on, and leaves the call to you. `[` brings
back short points from your **other notes** on the same idea (`Supports: … — [[Note]]`).
`#` turns several lines (or one paragraph) into topics: each a heading over a
tree of points in the pen's ink (`^ai-g-…`), every line led by a bold label
for what kind of line it is (**Theory:**, **Reason:**, **Example:**…). Which
branches a topic has and how deep it goes come from your writing, not a
fixed template; your own words, untouched, sit under the points they back.
There is no Shorten pill any more.
**Spec:** SPECs/second-pen-spec.md
**Code:** `src/components/editor-area/second-pen.ts`, `src/components/editor-area/pen-box.tsx`, `src/components/arc/floating-button-group/`, `src/components/editor-area/second-pen.css`, `src/components/editor-area/pen-hint-store.ts`, `src/components/editor-area/document-footer.tsx`, `src/components/editor-area/editor-extensions.ts`, `src/lib/second-pen.ts`, `src/lib/second-pen-agent.ts`, `src/lib/video-transcript.ts`, `src/lib/tauri.ts`, `src-tauri/src/commands/agent.rs`, `src-tauri/src/commands/papers.rs`, `src-tauri/src/commands/search.rs`, `src-tauri/src/file_cache.rs`

| ID     | Journey                                                                                                  | Expected                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Check                                |
| ------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| PEN-01 | ★ ⌘. then `!` on a bullet                                                                                | A sealed answer (blurred, `^ai-s-…`) appears as its sub-bullet, an empty take right beside it (same level) with the caret and _Your take first…_                                                                                                                                                                                                                                                                                                                           | auto: pen                            |
| PEN-02 | ⌘., then Esc                                                                                             | A box opens above the line: pills that show their keys (! Answer, @ Check, [[ Connect; no − Shorten) and a box to type in, with the keyboard in it; no Ask me, Facts or Mix; Esc closes it                                                                                                                                                                                                                                                                                 | auto: pen                            |
| PEN-03 | Enter on the empty take under a sealed answer                                                            | Nothing opens; the bar says a wrong guess counts                                                                                                                                                                                                                                                                                                                                                                                                                           | auto: pen                            |
| PEN-04 | Enter on one of several echoes                                                                           | An empty line opens under it; every echo stays                                                                                                                                                                                                                                                                                                                                                                                                                             | auto: pen                            |
| PEN-05 | Esc right after Connect writes its echoes                                                                | Those echoes are taken back; echoes written earlier stay                                                                                                                                                                                                                                                                                                                                                                                                                   | auto: pen                            |
| PEN-06 | Write a real take, Enter                                                                                 | The answer opens (`^ai-r-…`); nothing else moves and no comparison is written; an empty line under your take says _Put the two together, in your words…_ with **Combine into one list `Tab`** right after the words                                                                                                                                                                                                                                                        | auto: pen                            |
| PEN-07 | ⌘. then `@` on a claim                                                                                   | _For:_ (`^ai-p-…`) and _Against:_ (`^ai-n-…`) lines, papers as pills, an empty line under Against                                                                                                                                                                                                                                                                                                                                                                          | auto: pen                            |
| PEN-08 | (removed 2026-10-15: Shorten is gone, Organize cuts instead)                                             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | removed                              |
| PEN-09 | Hover a paper pill, click **Open paper**                                                                 | A card shows the paper's title, authors, venue, year and citations; the paper opens                                                                                                                                                                                                                                                                                                                                                                                        | you                                  |
| PEN-10 | Write nonsense as your take (`sad lion sits there`), Enter                                               | The answer stays sealed; the bar says it doesn't read as a take                                                                                                                                                                                                                                                                                                                                                                                                            | auto: pen                            |
| PEN-11 | ⌘. then `!` on a plain (non-bullet) line                                                                 | A plain sealed line appears right below it, a blank line apart, the take bullet under it                                                                                                                                                                                                                                                                                                                                                                                   | auto: pen                            |
| PEN-12 | ⌥↵ on an empty take (an earlier answer, take under it)                                                   | The answer opens (`^ai-r-…`); the empty take goes                                                                                                                                                                                                                                                                                                                                                                                                                          | auto: pen                            |
| PEN-13 | ⌘. then `!` on a question in a video note                                                                | The sealed answer comes from the transcript and ends with its time (`— 1:10`)                                                                                                                                                                                                                                                                                                                                                                                              | auto: pen                            |
| PEN-14 | ⌘., type a question in the box, Enter                                                                    | Your question goes in as a sub-bullet of the line; the sealed answer (`^ai-s-…`) under it                                                                                                                                                                                                                                                                                                                                                                                  | auto: pen                            |
| PEN-15 | ⌘. then `[` on a line another note speaks to                                                             | Short echoes `Label: one sentence — [[Note]]` (`^ai-e-…`, label like Supports or Example, about 20 words) appear under it, label (bold) and link in the same blue as the words; the link opens that note                                                                                                                                                                                                                                                                   | auto: pen                            |
| PEN-16 | Select several lines, ⌘., `#` Enter, then Esc                                                            | An outline replaces them, tinted; Esc puts your lines back exactly                                                                                                                                                                                                                                                                                                                                                                                                         | auto: pen                            |
| PEN-17 | Select several lines, ⌘., `#` Enter, then Enter                                                          | Under the outline: _N topics. Your words sit under the points they back._; Enter keeps it, bold-labelled pen points, your lines as you wrote them                                                                                                                                                                                                                                                                                                                          | auto: pen                            |
| PEN-18 | ⌘., type `@` (or a full-width `［`), then Backspace                                                      | The key lights its pill and types nothing; Backspace unselects it                                                                                                                                                                                                                                                                                                                                                                                                          | auto: pen                            |
| PEN-19 | ⌘., click a pill, then Enter                                                                             | The click only selects the pill (nothing written); Enter runs it                                                                                                                                                                                                                                                                                                                                                                                                           | auto: pen                            |
| PEN-20 | ⌘., type text, then `@` after a space, Enter                                                             | `@` picks Check and isn't typed; your text goes in as a line, For and Against under it                                                                                                                                                                                                                                                                                                                                                                                     | you                                  |
| PEN-21 | Select, or double-click, a line with a paper                                                             | The citation stays a pill (no link or details in the text)                                                                                                                                                                                                                                                                                                                                                                                                                 | you                                  |
| PEN-22 | ⌘. on one line, then on several selected lines                                                           | **# Organize** is offered on one line and with several selected; picking it keeps the box as wide as its pills (no empty space after # Organize), and _Add a direction, or just press Enter_ shows uncut                                                                                                                                                                                                                                                                   | auto: pen                            |
| PEN-23 | ⌘. then `@` on a how-to line (`how to make a new habit stick`)                                           | Two lines labelled for what it asks (e.g. _How:_ / _Caveat:_), never _For_ / _Against_; Esc takes them back                                                                                                                                                                                                                                                                                                                                                                | auto: pen                            |
| PEN-24 | Esc on the empty line under _Against_                                                                    | For and Against are taken back                                                                                                                                                                                                                                                                                                                                                                                                                                             | auto: pen                            |
| PEN-25 | Tab (or **Combine**) on the empty line under an opened answer and your take                              | After _Reading yours…_, the answer and your take are replaced by one MECE tree at their level: your points in your own words (every word, one idea per point), the pen's (`^ai-r-…`) only where they add something (never your take again, even reworded), a point's part, step or detail nested under it (two levels at most) whoever wrote either; no heading, no colour band; an empty last line says _Add a point, or go deeper on any line above…_ with **Undo `⌘Z`** | auto: pen                            |
| PEN-26 | **Undo** (or ⌘Z) right after Combine                                                                     | The opened answer, your take and the empty line with Combine are back exactly                                                                                                                                                                                                                                                                                                                                                                                              | auto: pen                            |
| PEN-27 | After Combine, click another line with the last line empty                                               | The empty line under the list goes                                                                                                                                                                                                                                                                                                                                                                                                                                         | auto: pen                            |
| PEN-28 | In a big iCloud vault, open it, then ⌘. `[` Enter on a line                                              | Echoes land in a few seconds (well under 30s), the first Connect after opening included                                                                                                                                                                                                                                                                                                                                                                                    | you                                  |
| PEN-29 | Combine when the pen only echoes your take                                                               | Your points once in your ink; the pen's are its answer's own points, never your words                                                                                                                                                                                                                                                                                                                                                                                      | manual (logic in second-pen.test.ts) |
| PEN-30 | Select a flat list, ⌘., `#` Enter, then Enter                                                            | A heading per topic, its first line a bold-labelled point of the pen's (two sentences at most, ink `^ai-g-…`); every pen line led by a bold label, no fixed **Evidence:** section; every line you selected is there word for word; the label is bold on screen, in the same blue as the line                                                                                                                                                                               | auto: pen                            |
| PEN-31 | Organize `fruit` / apple, banana, blueberry › benefit › types › biomechanical (your example), then Enter | Every level you wrote stays: blueberry, then its benefit, its types and biomechanical each a level deeper, under the pen's points                                                                                                                                                                                                                                                                                                                                          | auto: pen                            |
| PEN-32 | At the end of a long paragraph whose start is scrolled above the page, ⌘.                                | The box opens on screen, just above the caret, not up at the paragraph's start                                                                                                                                                                                                                                                                                                                                                                                             | you                                  |
| PEN-33 | Select lines up from the bottom of a long note (start scrolled away), ⌘.                                 | The box opens on screen, above the caret                                                                                                                                                                                                                                                                                                                                                                                                                                   | auto: pen                            |

## Claude sign-in — AUTH

**Feature:** When the pen (Organize and the rest) or the Agent fails because
Claude Code is signed out, a popup offers **Sign in**: Claude Code opens the
browser, and once the writer approves there the popup says Signed in.
Settings → Agent → Claude shows whether Claude Code is signed in, with
**Sign in** or **Sign out**.
**Spec:** SPECs/claude-sign-in-spec.md
**Code:** `src/components/claude-sign-in/`, `src/components/settings-panel/claude-account-row.tsx`, `src/stores/claude-sign-in-store.ts`, `src/lib/agent-stream.ts` (SIGNED_OUT_TEXT), `src/lib/second-pen-agent.ts`, `src/stores/agent-store.ts`, `src-tauri/src/commands/claude_auth.rs`, `src-tauri/src/commands/agent.rs` (claude_command)

| ID      | Journey                                                                                      | Expected                                                                                                                                                                                                                                       | Check      |
| ------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| AUTH-01 | ★ Signed out, send the Agent a message; Esc                                                  | The chat says _Claude is signed out. Sign in, then try again._ (no raw 401 JSON); the popup floats over the window with no backdrop (the app behind it still takes clicks) with **Not now `Esc`** · **Sign in `↵`**, keys in it; Esc closes it | auto: auth |
| AUTH-02 | Signed out, **Sign in**, then **Cancel**                                                     | The browser opens Claude's sign-in page; the popup says _Finish signing in in your browser…_, same size, buttons in place, with the code field and **Open the sign-in page again**; Cancel closes it and nothing stays signing in              | auto: auth |
| AUTH-03 | Signed out, ⌘. on a line, `#` Enter, **Sign in**, approve in the browser, run Organize again | The popup says _Signed in_ and closes by itself; Organize then works                                                                                                                                                                           | you        |
| AUTH-04 | Browser shows a code instead of returning: paste it, Continue                                | Signing in finishes as in AUTH-03                                                                                                                                                                                                              | you        |
| AUTH-05 | Open Settings                                                                                | Agent → **Claude** says _Signed in…_ with **Sign out**, or _Signed out…_ with **Sign in**, matching `claude auth status`                                                                                                                       | auto: auth |
| AUTH-06 | Signed out, Settings → **Sign in**, then **Cancel**                                          | The popup opens waiting (_Finish signing in in your browser…_); the row's button says **Waiting…**, disabled; Cancel closes the popup, the row offers **Sign in** again, and Claude Code is still signed out                                   | auto: auth |
| AUTH-07 | Signed in, Settings → **Sign out**                                                           | The row says _Signed out…_ with **Sign in**; `claude auth status` says signed out; the next Organize or Agent message offers the sign-in popup. Auto only on a sandbox Claude (`CLAUDE_CONFIG_DIR`)                                            | auto: auth |
| AUTH-08 | Signed out, Settings → **Sign in**, approve in the browser                                   | The popup says _Signed in_ / _Organize, the pen and the Agent are ready._ and closes by itself; the row says _Signed in…_ with **Sign out**                                                                                                    | you        |
| AUTH-09 | Signed in through an `ANTHROPIC_API_KEY` in the shell, Settings → **Sign out**               | The row says _Claude Code is still signed in. Run `claude auth logout` in Terminal to sign out._ and still offers **Sign out**. Auto only on a sandbox Claude with a dummy key                                                                 | auto: auth |

---

## Onboarding — ONB

**Feature:** A first launch with no folder open asks one question per screen: which notes to open (the writer's Obsidian vaults, a folder, or a new one), which AI to use (Claude Code: use, sign in or install), and something to try Pensée on (a YouTube video, a podcast, a book or a blank note). The sample opens as a real note in `Pensée samples/` with a guide for one loop; then a carousel of animated demos shows the rest. ⌘P → **Show Onboarding** plays it again.
**Spec:** SPECs/onboarding-spec.md
**Code:** `src/components/onboarding/`, `src/App.tsx`, `src/components/command-palette/index.tsx` (show-onboarding), `src/lib/tauri.ts` (obsidianVaults, claudeInstalled, createStarterFolder, downloadSampleBook), `src-tauri/src/commands/onboarding.rs`, `e2e/qa/seed-vault.mjs` (seedFirstRun)

| ID     | Journey                                                                   | Expected                                                                                                                                    | Check            |
| ------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| ONB-01 | ★ First launch, no folder open; ↵                                         | _Open your second brain._ lists the Obsidian vault with its note count, focused; ↵ opens it and the AI screen follows                       | auto: onboarding |
| ONB-02 | On the AI screen, **Other options**, then **Skip for now**                | Claude Code is offered (Use, Sign in, or the install command); Codex and Gemini CLI say _Coming soon_; Skip goes to the samples             | auto: onboarding |
| ONB-03 | **Just write**                                                            | A note opens in `Pensée samples/`; the guide says _1 of 2 … for Answer_ with **Skip**; Skip goes to the carousel                            | auto: onboarding |
| ONB-04 | In the carousel, →, then **Start writing**                                | → moves to the board demo; Start writing closes onboarding and saves `onboarding.done`, so the next launch opens straight into the vault    | auto: onboarding |
| ONB-05 | ⌘P → **Show Onboarding**, Skip for now, **YouTube**, click the empty line | The video note opens at 1:38:02; Pensée types _Rewarding yourself after studying…_ into the line; the guide says _Now ⌘S pins it to …_      | auto: onboarding |
| ONB-06 | YouTube, ⌘S, then ⌘. `@` ↵ (signed in)                                    | The line is pinned; Check writes For and Against with papers; the guide offers **Continue**                                                 | you              |
| ONB-07 | **Book**                                                                  | _The Elements of Style_ downloads from Project Gutenberg and opens beside its page; Highlight lands a bullet and the guide moves to ⌘. `[[` | you              |
| ONB-08 | **Podcast**, press play, click the line, ⌘S                               | The episode plays from 12:01 with its artwork; the line is written and pinned                                                               | you              |
| ONB-09 | Swipe the carousel with two fingers                                       | The slides follow the fingers and settle on the nearest one; one swipe moves once                                                           | you              |

---

## What's new — WN

**Feature:** When Pensée is updated, a card in the bottom-right corner shows once what changed since the writer last looked: every day of the CHANGELOG.md the app was built with that is newer than the last one seen (it holds the app's changes only). It has a painting with its credit, `What's new · N changes`, the day or run of days, and the first sentence of each change (three, then **N more**). **Got it** or **Read all** (the website's What's new page, on the newest day) closes it until the next update; ⌘P → **Show What's New** brings back the newest day.
**Spec:** SPECs/whats-new-card-spec.md
**Code:** `src/components/whats-new/`, `src/lib/whats-new.ts`, `src/App.tsx`, `src/components/command-palette/index.tsx` (show-whats-new), `src/lib/tauri.ts` (readChangelog), `src-tauri/src/commands/changelog.rs`, `e2e/qa/seed-vault.mjs` (seedWhatsNew, the changelog fixture), `e2e/qa/run.sh` (PENSEE_CHANGELOG_FILE)

| ID    | Journey                                                  | Expected                                                                                                                                                | Check           |
| ----- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| WN-01 | ★ Launch with two changelog days after the last one seen | The card shows bottom-right without taking focus: its painting and credit, _What's new · 6 changes_, _October 17–18_, three first sentences, **3 more** | auto: whats-new |
| WN-02 | **3 more**                                               | All six changes show in place, the older day's last                                                                                                     | auto: whats-new |
| WN-03 | **Got it**                                               | The card fades out and `whatsNew.lastSeen` is the newest day, so it doesn't show again                                                                  | auto: whats-new |
| WN-04 | ⌘P → **Show What's New**                                 | The newest day's card shows again                                                                                                                       | auto: whats-new |
| WN-05 | A first launch (nothing seen yet)                        | No card: the newest day is recorded as seen, and onboarding has the screen                                                                              | you             |
| WN-06 | **Read all**                                             | The website's What's new page opens in the browser at the card's newest day, and the card closes                                                        | you             |
| WN-07 | Change only the website, rebuild nothing                 | No card: the installed app's changelog is the one it was built with                                                                                     | you             |

## Windows — WIN

**Feature:** Pensée runs on Windows as well as the Mac, from the same code. On Windows it has the native title bar, Ctrl in place of ⌘ (in keys and in every label), and no Mac-only features (Apple Books import, translucency, the `pensee` command). On the Mac nothing changes. How each difference is made: [docs/platforms.md](../platforms.md).
**Code:** `src-tauri/tauri.windows.conf.json`, `src-tauri/src/path_ext.rs` (and every `to_ipc_lossy` / `canonical` call), `src-tauri/src/commands/agent.rs` (resolve_claude_binary, probe_login_path), `src-tauri/src/commands/onboarding.rs` (obsidian_config), `src-tauri/src/lib.rs` (install_app_menu), `src/lib/platform.ts`, `src/main.tsx` (data-platform), `src/App.css` (`[data-platform="windows"]`), `.github/workflows/ci.yml`, `.github/workflows/release-windows.yml`

| ID     | Journey                                                                                                    | Expected                                                                                                        | Check |
| ------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----- |
| WIN-01 | ★ On Windows, install from the release's setup.exe and launch                                              | Pensée opens with a native title bar; onboarding (or the last folder) shows, the chrome starts at the left edge | you   |
| WIN-02 | Open a folder, open a note, rename it, move it into a folder                                               | The note opens once (no duplicate tab), the rename and move land on disk, Files shows the new place             | you   |
| WIN-03 | Change a note in the folder from Explorer or Notepad                                                       | The open note updates within a couple of seconds                                                                | you   |
| WIN-04 | Ctrl+O, Ctrl+N, Ctrl+[; hover the sidebar button                                                           | Each does what ⌘ does on the Mac; the tooltip reads `Hide sidebar Ctrl+[`                                       | you   |
| WIN-05 | Paste a picture into a note                                                                                | It is saved next to the note and shows inline                                                                   | you   |
| WIN-06 | Ctrl+wheel with a mouse over a board                                                                       | The board zooms one step a notch, not two or three                                                              | you   |
| WIN-07 | With Claude Code installed (even after Pensée), open onboarding's AI screen, then send the Agent a message | Claude Code is found; the Agent answers; no console window flashes                                              | you   |
| WIN-08 | ⌘P on the Mac and Ctrl+P on Windows → type "Apple Books"                                                   | Mac: the import command is listed. Windows: it is not, and Settings has no Apple Books sync or Translucency     | you   |
| WIN-09 | On a Windows PC that never ran Pensée, launch it                                                           | The window fills the screen with onboarding's first question; the carousel says "touchpad"                      | you   |
| WIN-10 | Ctrl+, anywhere in a workspace window                                                                      | Preferences opens in a tab, as from the File menu                                                               | you   |

---

## Template for a new feature

```md
## <Feature name> — <AREA>

**Feature:** <one or two sentences: what the user can do, in their words>
**Spec:** SPECs/<feature>-spec.md
**Code:** `<paths a change would have to touch to break it>`

| ID        | Journey                          | Expected                               | Check        |
| --------- | -------------------------------- | -------------------------------------- | ------------ |
| <AREA>-01 | ★ <the one thing that must work> | <what the user sees / what is on disk> | auto: <name> |
```
