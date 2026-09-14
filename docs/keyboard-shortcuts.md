# Keyboard Shortcuts

Canonical shortcut reference for Writer.

## Global

These shortcuts are handled by the global `useKeyboardShortcuts` hook and work regardless of editor focus.

| Shortcut        | Action                        |
| --------------- | ----------------------------- |
| Cmd+P           | File search (command palette) |
| Cmd+O           | Go to file                    |
| Cmd+N           | Create new note               |
| Cmd+Shift+N     | Create or open today's note   |
| Cmd+T           | New tab                       |
| Cmd+W           | Close current tab             |
| Cmd+\\          | Toggle sidebar                |
| Cmd+[           | Toggle sidebar                |
| Cmd+]           | Toggle sidebar                |
| Ctrl+Tab        | Next tab                      |
| Ctrl+Shift+Tab  | Previous tab                  |
| Cmd+1 ... Cmd+9 | Jump to Nth tab               |
| Alt+ArrowLeft   | Navigate back                 |
| Alt+ArrowRight  | Navigate forward              |
| Cmd+= / Cmd++   | Zoom in                       |
| Cmd+-           | Zoom out                      |
| Cmd+0           | Actual size (100%)            |

In compact single-file windows, sidebar and tab-management shortcuts do not
create hidden UI state: Cmd+\\, Cmd+[, Cmd+], Cmd+T, Ctrl+Tab, Ctrl+Shift+Tab, and Cmd+1 ...
Cmd+9 are ignored. Cmd+P, Cmd+O, Cmd+N, and history navigation still work.
Cmd+Shift+N needs a workspace to file the note in, so it is inert there too.

Zoom scales the whole window (WebKit page zoom, persisted in the global
`appearance.zoom` setting) and steps along the browser ladder 50 · 67 · 75 · 80 ·
90 · 100 · 110 · 125 · 150 · 175 · 200 · 250 · 300. The board canvas binds the
same keys to its own viewport and wins while it is focused. The View menu carries
the same three actions; its accelerators only fire when the page did not consume
the key, so a press never zooms twice.

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
| Cmd+E                   | Inline code               |
| Cmd+Shift+X             | Strikethrough             |
| Cmd+Shift+8             | Bullet list               |
| Cmd+Shift+7             | Numbered list             |
| Cmd+Shift+.             | Blockquote                |
| Cmd+Shift+Enter         | Task list                 |
| Cmd+Alt+1 ... Cmd+Alt+6 | Heading 1-6               |
| Cmd+Alt+0               | Paragraph (strip heading) |

## Editor (inherited from CodeMirror)

Standard editing shortcuts provided by CodeMirror's basic setup. Indent is rebound from CodeMirror's Cmd+[ / Cmd+] to Cmd+Shift+[ / Cmd+Shift+] in `editorDefaultKeymap` (`basicSetup.ts`), which every editor uses, so Cmd+[ can toggle the sidebar app-wide.

| Shortcut             | Action                         |
| -------------------- | ------------------------------ |
| Cmd+Z                | Undo                           |
| Cmd+Shift+Z          | Redo                           |
| Cmd+A                | Select all                     |
| Cmd+D                | Select next occurrence         |
| Alt+ArrowUp          | Move line up                   |
| Alt+ArrowDown        | Move line down                 |
| Alt+Shift+ArrowUp    | Copy line up                   |
| Alt+Shift+ArrowDown  | Copy line down                 |
| Cmd+Shift+K          | Delete line                    |
| Cmd+Enter            | Insert line below              |
| Cmd+Shift+Enter      | Insert line above              |
| Tab                  | Indent / accept completion     |
| Shift+Tab            | Dedent                         |
| Cmd+Shift+]          | Indent more                    |
| Cmd+Shift+[          | Indent less                    |
| Cmd+F                | Find                           |
| Cmd+H                | Find and replace               |
| Cmd+G                | Find next                      |
| Cmd+Shift+G          | Find previous                  |
| Escape               | Close find                     |
| Alt+Shift+ArrowLeft  | Extend selection by word left  |
| Alt+Shift+ArrowRight | Extend selection by word right |
