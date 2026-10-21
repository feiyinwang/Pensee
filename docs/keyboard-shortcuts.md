# Keyboard Shortcuts

Canonical shortcut reference for Pensée. Keys follow Obsidian's macOS
defaults wherever Pensée has the same action, so moving over costs nothing
([SPECs/obsidian-shortcuts-spec.md](../SPECs/obsidian-shortcuts-spec.md) lists
each choice and where Pensée keeps its own key).

## The rules

Every new key follows these ([the system](../SPECs/obsidian-shortcuts-spec.md#the-system)):

1. **Five keys to learn**, each Cmd + the first letter of what it does:
   Cmd+N new note, Cmd+T today, Cmd+O open a note, Cmd+P everything else,
   Cmd+S save the moment in a video or podcast note.
2. **The go key for places**: Cmd+G, then T Today, P Projects, L Library,
   F Files. Cmd + a number is a tab.
3. **Shift only means the bigger version of the same key** (Cmd+F this
   note → Cmd+Shift+F every note).
4. Same action as Obsidian → Obsidian's key; an Obsidian key never gets a
   different meaning.
5. Anything else is a command in Cmd+P, which shows its key.
6. Alt only in standard text editing, and Cmd+Alt for headings and history.

## Global

These shortcuts are handled by the global `useKeyboardShortcuts` hook and work regardless of editor focus.

| Shortcut        | Action                                   |
| --------------- | ---------------------------------------- |
| Cmd+O           | Find a note (recent notes until you type) |
| Cmd+Shift+F     | Find a note, by name for now             |
| Cmd+P           | Commands, each with its key              |
| Cmd+T           | Today's note (made if missing)           |
| Cmd+G, then T   | Today's note⁴                            |
| Cmd+G, then P   | Go to Projects⁴                          |
| Cmd+G, then L   | Go to Library⁴                           |
| Cmd+G, then F   | Go to Files⁴                             |
| Cmd+N           | New note (the composer)                  |
| Cmd+Enter       | Composer: create and open it             |
| Cmd+Shift+Enter | Composer: create, stay here³             |
| Cmd+W           | Close current tab                        |
| Cmd+Shift+T     | Reopen the last closed tab               |
| Cmd+\\          | Toggle sidebar                           |
| Cmd+[           | Toggle sidebar                           |
| Cmd+]           | Toggle the calendar panel                |
| Ctrl+Tab        | Next tab                                 |
| Ctrl+Shift+Tab  | Previous tab                             |
| Cmd+1 ... Cmd+8 | Jump to Nth tab                          |
| Cmd+9           | Jump to the last tab                     |
| Cmd+Alt+Left    | Navigate back                            |
| Cmd+Alt+Right   | Navigate forward                         |
| Cmd+= / Cmd++   | Zoom in                                  |
| Cmd+-           | Zoom out                                 |
| Cmd+0           | Actual size (100%)                       |
| Cmd+J           | Toggle the agent chat                    |
| Cmd+S           | Pin the moment and pause; again, play¹   |
| Shift+, / .     | Video slower / faster²                   |
| Left / Right    | Video 5s back / on, over it⁵             |

The composer's dated-today and Library presets are commands in Cmd+P
(**New Note for Today**, **Add to Library…**), and its own Date and Type chips.

In compact single-file windows, sidebar and tab-management shortcuts do not
create hidden UI state: Cmd+\\, Cmd+[, Cmd+], Cmd+J, Cmd+T, Cmd+G, Cmd+Shift+T, Ctrl+Tab, Ctrl+Shift+Tab, and Cmd+1 ...
Cmd+9 are ignored. Cmd+O / Cmd+P / Cmd+Shift+F, Cmd+N (the palette's create field there),
and history navigation still work. The composer
([SPECs/composer-spec.md](../SPECs/composer-spec.md)) needs a workspace to file
notes in, so Cmd+] is inert there too.

¹ Only while a YouTube or podcast note's player is open; handled in
`video-pin.ts`, not the global hook. Cmd+S works only in a note that plays a
video or episode, on its player, or on a board (which swallows Cmd+S anyway);
everywhere else it does nothing, since notes save themselves
([SPECs/youtube-notes-spec.md](../SPECs/youtube-notes-spec.md),
[SPECs/podcast-notes-spec.md](../SPECs/podcast-notes-spec.md)). While the
video plays it pins the moment and pauses, so you can write about it; while
it is paused it plays on. The player names every key in full, a label then
its key (Play or Pin ⌘S, Slower ⇧,, Faster ⇧.): at the start of the row under
a video, before **Transcript**, and under a podcast's card. They stand in for
Play and Pin buttons, which the players don't have. ⌘S is named for what it
does now: Play while paused, Pin while playing. "Video" means the episode in a podcast note.

² In a note that plays a video or episode (or with nothing editable focused
while one is open), Shift+, and Shift+. change its speed instead of typing;
elsewhere they type. They match by key as well as by character (`<` `>`), so
they work with an input source such as Pinyin that types 《 》 there.

⁵ Only while the pointer is over a YouTube video (its page reports enter and
leave); then they skip it instead of moving the caret, wherever focus is.
Handled in `video-pin.ts` with the other player keys.

³ Writing into a day's note (no title, a date) opens that note instead.

⁴ The go key (`handleGoKey` in `use-keyboard-shortcuts.ts`): Cmd+G waits
1.5s for a letter, and each sidebar row shows its letter in a box
(`sidebar-spaces.tsx`); with the sidebar hidden, a tray at the bottom centre names
them instead (`components/go-key-hint.tsx`). It is captured before the editor, so it works
mid-sentence and the letter never types; the key after Cmd+G is taken
whatever it is, and Esc just ends the wait. Each built-in space's letter is
its `goKey` in `lib/spaces.ts`. A focused board keeps Cmd+G (group) and the
find bar keeps it (find next). Hovering a built-in space in the sidebar shows
a tooltip with what it does and its keys; spaces you add have no letter and no
tooltip.

Zoom scales the whole window (WebKit page zoom, persisted in the global
`appearance.zoom` setting) and steps along the browser ladder 50 · 67 · 75 · 80 ·
90 · 100 · 110 · 125 · 150 · 175 · 200 · 250 · 300. The board canvas binds the
same keys to its own viewport and wins while it is focused. The View menu carries
the same three actions; its accelerators only fire when the page did not consume
the key, so a press never zooms twice.

On a focused board, Alt+ArrowLeft / Alt+ArrowRight are claimed for card travel
(out to the card leading into the selected one / into its next steps); Tab /
Shift+Tab step between cards on the same level. A board's own find is Cmd+F.

In the Projects space ([project views](../SPECs/project-views-spec.md)), a
focused kanban card takes Space (lift, then drop), the arrow keys (move a
lifted card) and Escape (put it back), as Arc's kanban board defines them; a
focused timeline bar takes ArrowLeft / ArrowRight (move a day) and
Shift+ArrowLeft / Shift+ArrowRight (move its deadline). History navigation
is on Cmd+Alt+Arrow, so none of these keys collide with it.

## Menu Accelerators

These shortcuts are bound to the native app menu (Tauri menu accelerators) rather than the global JS handler.

| Shortcut | Action                                                |
| -------- | ----------------------------------------------------- |
| Cmd+,    | Open Preferences (Settings tab) in the focused window |
| Cmd+=    | View › Zoom In (shown as ⌘= since muda has no Plus)   |
| Cmd+-    | View › Zoom Out                                       |
| Cmd+0    | View › Actual Size                                    |

## Editor Formatting

These shortcuts are handled by the `markdownFormatting` CodeMirror extension and only apply when the editor is focused.

| Shortcut                | Action                    |
| ----------------------- | ------------------------- |
| Cmd+B                   | Bold                      |
| Cmd+I                   | Italic                    |
| Cmd+K                   | Insert link               |
| Cmd+L                   | Toggle checkbox status¹   |
| Cmd+Shift+X             | Strikethrough             |
| Cmd+Shift+8             | Bullet list               |
| Cmd+Shift+7             | Numbered list             |
| Cmd+Shift+.             | Blockquote                |
| Cmd+Shift+Enter         | Task list                 |
| Cmd+Alt+1 ... Cmd+Alt+6 | Heading 1-6               |
| Cmd+Alt+0               | Paragraph (strip heading) |
| Cmd+Alt+N               | Move selection to page…   |
| Cmd+Shift+C             | Copy block reference      |
| Cmd+Alt+V               | Paste as linked block     |
| Alt+Enter               | Follow the link at caret  |
| Cmd+Enter (on a link)   | Follow the link at caret² |

Inline code has no key: Cmd+E is Obsidian's reading view, which Pensée doesn't
have, so it does nothing. Cmd+Shift+V is the webview's plain paste.

¹ On task lines it ticks or unticks each (and celebrates, like a click);
otherwise each line becomes an open task (`- [ ] `; a bullet gains its box).

² Obsidian opens it in a new tab; following a link already opens it beside.
Off a link, Cmd+Enter keeps its CodeMirror meaning (insert line below).

## Second pen

The `secondPen` CodeMirror extension ([SPECs/second-pen-spec.md](../SPECs/second-pen-spec.md)).
⌘. opens the pen's box above the selection or the caret's line: pills, and a
box to type in.

| Shortcut                   | Action                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cmd+.                      | Open / close the pen's box                                                                                                                              |
| ! @ [ # (or full-width)    | At the start of the box or after a space: select that pill (Answer, Check, Connect, Organize); again or Backspace unselects                             |
| Click a pill               | Select it (nothing runs yet)                                                                                                                            |
| Enter                      | Run the selected pill, steered by what you typed; none selected: ask the AI what you typed. What you typed goes in as your own line, the pen's under it |
| Cmd+Enter (text typed)     | Ask me, steered by what you typed                                                                                                                       |
| Enter / Esc after Organize | Keep the outline / put your lines back                                                                                                                  |
| Enter on a pen line        | Answer under it (on a mix: keep it, drop the others)                                                                                                    |
| Enter on a quiz answer     | Check it against the source (empty: a hint first)                                                                                                       |
| Esc                        | Close the box, stop the pen, or take back an unanswered line                                                                                            |

## Editor (inherited from CodeMirror)

Standard editing shortcuts provided by CodeMirror's basic setup. Indent is rebound from CodeMirror's Cmd+[ / Cmd+] to Cmd+Shift+[ / Cmd+Shift+] in `editorDefaultKeymap` (`basicSetup.ts`), which every editor uses, so Cmd+[ can toggle the sidebar app-wide. Find is Cmd+Shift+F (`editor-search-extensions.ts`), since Cmd+F is search app-wide; a board's own find & replace is Cmd+Shift+F too.

| Shortcut             | Action                         |
| -------------------- | ------------------------------ |
| Cmd+Z                | Undo                           |
| Cmd+Shift+Z          | Redo                           |
| Cmd+A                | Select all                     |
| Cmd+ArrowUp          | Top of the page (⇧: select)    |
| Cmd+ArrowDown        | Bottom of the page (⇧: select) |
| Cmd+D                | Delete the line(s)             |
| Alt+ArrowUp          | Move line up                   |
| Alt+ArrowDown        | Move line down                 |
| Alt+Shift+ArrowUp    | Copy line up                   |
| Alt+Shift+ArrowDown  | Copy line down                 |
| Cmd+Shift+K          | Delete line                    |
| Cmd+Enter            | Insert line below              |
| Tab                  | Indent / accept completion     |
| Shift+Tab            | Dedent                         |
| Cmd+Shift+]          | Indent more                    |
| Cmd+Shift+[          | Indent less                    |
| Cmd+F                | Find in the note               |
| Cmd+Alt+F            | Find and replace               |
| Enter / Cmd+G        | Find next (in the find bar)    |
| Shift+Enter / Cmd+Shift+G | Find previous (in the find bar) |
| Escape               | Close find                     |
| Alt+Shift+ArrowLeft  | Extend selection by word left  |
| Alt+Shift+ArrowRight | Extend selection by word right |
