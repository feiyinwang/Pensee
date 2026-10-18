# Obsidian shortcuts

Pensée's readers come from Obsidian. A key that means one thing there and
another here costs them every day, so Pensée's keys follow Obsidian's macOS
defaults (1.x) wherever Pensée has the same action. Where Pensée keeps its own
meaning, Obsidian has no default for that key, or Pensée has no matching action.

Decided with the user on 2026-10-16, replacing `a8d13e3` (⌘F search; ⌘P, ⌘L
and ⌘O for the spaces).

## The system (decided 2026-10-16, from `proto/shortcuts`)

Mixed ⌥ and ⌘ keys, and ⌘⇧ keys whose ⇧ meant nothing, were hard to
remember. The rules every key follows now:

1. **Five keys to learn**, each ⌘ + the first letter of what it does:
   ⌘N new note · ⌘T today · ⌘O open a note · ⌘P everything else ·
   ⌘S save the moment (pin and pause in a video or podcast note; again plays).
2. **The go key for places**: ⌘G, then a letter: T Today, P Projects,
   L Library, F Files (Linear's G, held with ⌘ so it works mid-sentence).
   While it waits, each sidebar row shows its letter in a box (a strip at
   the top names them only when the sidebar is hidden). A new built-in space gets a
   letter (`goKey` in `lib/spaces.ts`). ⌘ + a number stays a tab.
3. **⇧ only means the bigger version of the same key**: ⌘F this note →
   ⌘⇧F every note; ⌘Z undo → ⌘⇧Z redo; ⌘W close tab → ⌘⇧T bring it back.
4. Same action as Obsidian → Obsidian's key. An Obsidian key never gets a
   different meaning; if Pensée lacks the action, the key does nothing.
5. Everything else is a command in ⌘P, with its key shown beside it.
6. ⌥ appears only in standard text editing (⌥↑↓ move line, ⌥⇧←→ select by
   word, ⌥↩ follow link) and ⌘⌥ for headings and back / forward.

What changed in the app:

| Before | Now | Why |
| ------ | --- | --- |
| ⌥P / ⌥L / ⌥F | ⌘G then P / L / F (T Today) | No ⌥ to learn; ⌥ + letter also typed π ¬ ƒ |
| ⌘G / ⌘⇧G find next / previous | ↵ / ⇧↵ in the find bar (⌘G still, while it has focus) | ⌘G is the go key |
| ⌘O and ⌘P open one list | ⌘O finds notes, ⌘P runs commands | Obsidian's split; each key does one thing |
| ⌘S pins, ⌘⇧J plays / pauses | ⌘S pins and pauses, ⌘S again plays | One key for listen → pin → write → listen; J meant nothing |
| ⌘⇧N / ⌘⇧L composer variants | ⌘P **New Note for Today** / **Add to Library…**, and the composer's Date and Type chips | ⇧ didn't mean "bigger"; ⌘⇧L had nothing to do with ⌘L. (Tab picking the kind, as in the prototype, would have broken Tab between the composer's fields.) |

Rejected, so it isn't discussed again:

- **Linear's G-then-X sequences**: bare letters only work outside text, and
  writers are in a note most of the time; reaching Projects took Esc, G, P.
- **⌘O then a letter** (letter jumps on an empty switcher): a search starting
  with T, P, L or F jumped instead of searching.
- **⌘⇧ + letter per place** (⌘⇧P, ⌘⇧L, ⌘⇧E): ⇧ meant nothing; ⌘⇧L and ⌘⇧F
  were taken, so Files got E.
- **Obsidian exactly (places only through ⌘P)**: no direct key for Projects,
  Library and Files felt wrong.
- **⌘1–4 for places**: ⌘ + a number is the tabs'.
- **⌃1–4 for places** (built, then replaced by the go key the same day): a
  second modifier to learn; letters read better than positions.
- **⌘⇧1–4**: ⌘⇧3 and ⌘⇧4 are macOS screenshots. **⌘⌥1–4**: headings, and ⌥.
- **A separate play key (⌘Y)**: no letter means play (P, K, Space are taken);
  a sixth key to learn.

Known cost: ⌘G is Obsidian's graph view, and Pensée has none, so an Obsidian
user pressing it gets the go strip instead. A board keeps ⌘G (group) and the
find bar keeps it (find next) while they have focus.

## Keys that now follow Obsidian

| Key       | Obsidian                       | Pensée now                                            | Pensée before           |
| --------- | ------------------------------ | ----------------------------------------------------- | ----------------------- |
| ⌘O        | Quick switcher                 | Find a note (recent notes until you type)             | Go to Files             |
| ⌘P        | Command palette                | Commands only, each with its key                      | Go to Projects          |
| ⌘⇧F       | Search in all files            | Search (the palette; names only, see Not yet)         | Find in the note        |
| ⌘F        | Search current file            | Find in the note                                      | Search                  |
| ⌥⌘F       | Search & replace current file  | Find in the note with Replace open                    | Nothing (⌘H in the docs, never bound) |
| ⌘L        | Toggle checkbox status         | Toggle checkbox status (a plain line becomes `- [ ]`) | Go to Library           |
| ⌘D        | Delete paragraph               | Delete the line(s) the selection touches              | Select next occurrence  |
| ⌘⇧V       | Paste without formatting       | The webview's plain paste (Pensée's paste is text anyway) | Paste as linked block |
| ⌥⌘← / ⌥⌘→ | Navigate back / forward        | Same, also with the cursor in a note                  | ⌥← / ⌥→, outside notes only |
| ⌘⇧T       | Undo close tab                 | Reopen the last closed tab                            | Nothing                 |
| ⌥Enter    | Follow link under cursor       | Follow the link under the caret (as a click does)     | Nothing                 |
| ⌘Enter    | Open link under cursor in new tab | On a link: follow it (a click already opens beside); elsewhere unchanged | Insert line below |
| ⌘9        | Last tab                       | Last tab                                              | Ninth tab               |
| ⌘E        | Toggle reading view            | Nothing (Pensée has no reading view)                  | Inline code             |

## Keys that moved to make room

| Action                 | New key      | Why                                                                 |
| ---------------------- | ------------ | ------------------------------------------------------------------- |
| Go to Projects         | ⌘G then P    | The go key; ⌘ + a number is a tab (was ⌥P).                         |
| Go to Library          | ⌘G then L    | as above (was ⌥L)                                                   |
| Go to Files            | ⌘G then F    | as above (was ⌥F)                                                   |
| Paste as linked block  | ⌥⌘V          | ⌘⇧V is plain paste in Obsidian and macOS.                           |

## Keys Pensée keeps

- ⌘T today's note (also ⌘G then T), ⌘N the composer. Its dated-today and Library
  presets are ⌘P commands now (**New Note for Today**, **Add to Library…**).
- ⌘\ and ⌘[ toggle the sidebar, ⌘] the calendar panel. Obsidian indents on
  ⌘] / ⌘[; Pensée indents with Tab / ⇧Tab (and ⌘⇧] / ⌘⇧[).
- ⌘J the Agent, ⌘. the pen, ⌘S in a video or podcast note: pin and pause,
  again to play (Obsidian's ⌘S saves, which notes here do on their own).
- ⌘G is the go key (Obsidian's ⌘G is graph view; Pensée has none). Find next
  / previous are ↵ / ⇧↵ in the find bar, and ⌘G / ⌘⇧G there.
- ⌘⇧C copy block reference; ⌘⌥1–6 headings; ⌘⇧X, ⌘⇧7, ⌘⇧8, ⌘⇧. formatting.
- ⌘K link, ⌘B, ⌘I, ⌘W, ⌘,, ⌃Tab, ⌘1–8, ⌥↑ / ⌥↓, ⌘⇧K: already Obsidian's.

## Reopen closed tab

The editor store keeps the last 20 tabs closed by the user (`closedTabs`: the
tab with its back/forward history and its index). `closeTab` records them;
internal closes (a file that failed to load) pass `remember: false`, and a
New tab page is never recorded. ⌘⇧T takes the newest, puts it back at its old
index (replacing a lone New tab page) and loads its file; a file that no longer
loads closes the tab again.

## Not yet

- ⌘⇧F searches note names and commands, not note text. Full-text search in
  the palette is its own task.
- ⌘P doesn't yet put the commands you used last at the top, as Obsidian's
  does.
- ⌘/ (comment), ⌘⌥Enter (open to the right), F2 (rename) have no Pensée action yet.

## Where

- `hooks/use-keyboard-shortcuts.ts` — ⌘O / ⌘P, the go key (`handleGoKey`), ⌥⌘ arrows, ⌘⇧T, ⌘9.
- `lib/spaces.ts` — `goKey` on the built-in spaces, `goTargetForKey`, `goKeyPlaces`.
- `components/go-key-hint.tsx` — the tray at the bottom centre that names the letters while ⌘G waits.
- `components/command-palette/index.tsx` — the `search` (⌘O) and `commands` (⌘P) lists.
- `components/editor-area/video-pin.ts` — ⌘S, `saveTheMoment`.
- `stores/editor-store.ts` — `closedTabs`, `reopenClosedTab`.
- `components/editor-area/editor-search-extensions.ts`, `editor-search-store.ts`,
  `editor-search-overlay.tsx` — ⌘F, ⌥⌘F with Replace open.
- `components/editor-area/markdown-formatting.ts` — ⌘L checkbox, ⌘E removed.
- `lib/prosemark-core/basicSetup.ts` — ⌘D delete line.
- `components/editor-area/block-embed.ts` — ⌥⌘V.
- `components/editor-area/link-navigation.ts` — ⌥Enter / ⌘Enter on a link.
- `components/sidebar/sidebar-spaces.tsx`, `sidebar/file-browser.tsx` — tooltips and the Search hint.
- `docs/keyboard-shortcuts.md` — the canonical map.
