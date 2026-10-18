# Coming from Obsidian

Status: proposed framework, not decided (2026-10-16). Each P0/P1 item below
gets its own spec when it is picked up; this file is the map they hang off.

## Goal

Someone with an Obsidian vault opens it in Pensée and, on day one:

- nothing in the vault is lost, copied or rewritten,
- nothing in their notes looks broken,
- their settings and their hands still work,
- they can see exactly what is different.

## The five promises

Every piece of transition work serves one of these. A feature that serves none
of them is not transition work.

| #   | Promise                       | Means                                                                                                                                                  |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Your files stay yours**     | The vault opens as it is. Pensée never writes into `.obsidian/`. Obsidian can stay open on the same folder. Renaming a note updates `[[links]]` to it. |
| 2   | **Your notes look right**     | Obsidian syntax renders. What Pensée can't run is shown read-only, never stripped or hidden.                                                           |
| 3   | **Your settings come along**  | Pensée reads `.obsidian/` config: the daily-note folder, format and template, the attachment folder, the link format, the templates folder.            |
| 4   | **Your hands still work**     | Keys follow Obsidian ([obsidian-shortcuts-spec.md](obsidian-shortcuts-spec.md)). The user's own `hotkeys.json` comes along. Every key can be changed.  |
| 5   | **You know what's different** | One report on open says what came along, what is read-only and what is not supported yet. Docs map Obsidian's words to Pensée's.                       |

## What other apps do

Research from 2026-10-16: 18 note apps for vault migration, 19 apps for
keyboard migration. "X/N" = how many of them do it.

**Vault migration**

| Mechanism                            | Coverage       | Who                                                                                             |
| ------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------- |
| Copies the vault into its own store  | 11/18          | Capacities, Anytype, Bear, NotePlan, Heptabase, Craft, Amplenote, Mem, Reflect, Dendron, AFFiNE |
| Opens the vault in place             | 4/18           | Zettlr, Foam, iA Writer, Logseq (unofficial)                                                    |
| "Switching from Obsidian" page       | 7/18           | Capacities, Zettlr, Mem, Bear, NotePlan, Anytype, Craft                                         |
| Terminology map ("their X is our Y") | 3              | Capacities, Zettlr, Linear (from Jira)                                                          |
| Preview / analyse step before import | 2              | Capacities, Obsidian Importer                                                                   |
| Report of what was skipped           | 1              | Obsidian Importer (3.1.0)                                                                       |
| Recognises daily notes               | 1              | NotePlan                                                                                        |
| Reads `.obsidian/` config            | **0/18**       | —                                                                                               |
| Handles embeds, Dataview, Canvas     | **0** verified | —                                                                                               |

The importers that copy are also the ones users blame for lost embeds,
stripped Dataview blocks, broken block links and lost folders (Anytype,
Silverbullet and Logseq forums). Opening in place avoids that whole class.

The best flow found is Obsidian's own Importer for Logseq: it reads the source
app's config (`logseq/config.edn`), lands journals in _your_ daily-notes
folder and format, previews real notes, and reports what it couldn't bring
"instead of silently omitted". Nobody does the same for `.obsidian/`.

**Keyboard migration**

| Mechanism                          | Coverage | Who                                                                       |
| ---------------------------------- | -------- | ------------------------------------------------------------------------- |
| Rebind any command in the app      | 9/19     | VS Code, JetBrains, Zed, Cursor, Obsidian, Logseq, Raycast, Tana, Anytype |
| Palette or menu shows each key     | 7/19     | VS Code, Obsidian, Superhuman, Raycast, Bear, iA Writer, Typora           |
| Shortcut list behind `?`           | 7/19     | Linear, Figma, Logseq, Anytype, AFFiNE, VS Code, Zed                      |
| Conflict warning                   | 5/19     | VS Code, JetBrains, Raycast, Obsidian, Logseq                             |
| Keymap preset picked in onboarding | 3/19     | VS Code, JetBrains, Zed — **no note app**                                 |
| Imports another app's keymap       | 3/19     | Cursor, JetBrains, VS Code (Sublime)                                      |
| Mouse → "next time press X"        | 2/19     | Superhuman, JetBrains (Key Promoter X)                                    |
| Marks shortcuts you've used        | 1/19     | Figma                                                                     |

How presets avoid clashes: Zed layers base keymap → user file (later wins,
`null` unbinds). JetBrains stores user edits as a diff on a read-only preset,
with reset. Raycast names the command a key already belongs to and offers to
move it. Obsidian allows duplicates and runs one of them — users find that
confusing, so Pensée doesn't.

## Where Pensée stands today

| Promise       | Today                                                                                                                                                                                                                                                       | Evidence                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1 Files       | Partial. Opens in place; never touches `.obsidian/`. **Renaming a note breaks `[[links]]` to it.**                                                                                                                                                          | `src-tauri/src/commands/fs.rs:255`; `rebase-markdown-links` used only by the clipboard                                |
| 2 Syntax      | Partial. Wikilinks, aliases, heading and block links, image/video embeds, frontmatter, math, mermaid work. Missing: callouts, `==highlight==`, `%%comment%%`, footnotes, `#tags`, note and PDF embeds, `aliases:` in link resolution, custom task statuses. | `lib/wiki-links.ts`, `lib/prosemark-core/markdown/index.ts:24-34`, `wiki-link-extension.ts:185`                       |
| 3 Settings    | Mostly missing. Only the Templater/templates folder is read. Daily notes are always `YYYY-MM-DD` in Pensée's own folder; pasted images always go to `<note>-assets/`.                                                                                       | `lib/project-template.ts:10,16`, `lib/daily-note.ts:11`, `commands/images.rs:56`                                      |
| 4 Hands       | Partial. 14 keys moved to Obsidian's; about 10 still differ (⌘T, ⌘G, ⌘[ / ⌘], ⌘E…). No rebinding, no `hotkeys.json`.                                                                                                                                        | [obsidian-shortcuts-spec.md](obsidian-shortcuts-spec.md), [docs/keyboard-shortcuts.md](../docs/keyboard-shortcuts.md) |
| 5 Differences | Missing. Vault buttons from Obsidian's vault list are specced, not built. No report, no docs page.                                                                                                                                                          | [onboarding-spec.md](onboarding-spec.md)                                                                              |

## Priorities

Sorted on two questions: is it table stakes (most apps do it, or users lose
work without it)? Does anyone else already do it well?

### P0 — trust (table stakes; breaking these loses the user)

1. **Renaming a note updates `[[links]]` to it** across the vault. Today a
   rename breaks links silently.
2. **Obsidian syntax renders**: callouts, `==highlight==`, `%%comment%%`
   (hidden while reading, shown at the caret), footnotes, `#tags` (read, and
   nested ones — this reopens [tags-spec.md](tags-spec.md)'s "no nested
   tags"), whole-note and PDF embeds, `aliases:` in link resolution.
3. **Nothing is stripped.** Syntax Pensée doesn't understand stays visible as
   plain text. Dataview / Tasks query blocks show as a labelled read-only code
   block ("Dataview query — Pensée shows it, doesn't run it").
4. **Obsidian open on the same vault is safe**: Pensée never writes into
   `.obsidian/`, and external edits land through the file watcher
   ([external-file-watcher-spec.md](external-file-watcher-spec.md)). Covered
   by a journey that edits a note from outside while it is open.
5. **The welcome screen lists Obsidian's vaults** (`obsidian.json`), as
   [onboarding-spec.md](onboarding-spec.md) already specs.

### P1 — what nobody else does (0/18 read `.obsidian/`; no note app imports hotkeys)

6. **Read `.obsidian/` config, never write it.** In a vault that has it:
   - `daily-notes.json`: folder, date format, template → today's note (⌘T).
   - `app.json`: `attachmentFolderPath` → where pasted images go;
     `newLinkFormat` → shortest / relative / absolute for new links.
   - `templates.json` and Templater's folder (already read) → an
     **Insert template** command.
   - Pensée's own setting, once the user changes it, wins over `.obsidian/`.
7. **The compatibility report** (see below), shown once per vault.
8. **Keys you can change**: a keymap in settings with search by name and by
   pressing keys, conflict naming with "move it here", no silent duplicates,
   reset per key and for all. User changes are stored as a diff on top of
   Pensée's defaults.
9. **`hotkeys.json` comes along**: on first open, the user's own Obsidian
   hotkeys for commands Pensée has are applied as user changes; the report
   lists any that clash with a Pensée key and which one won.
10. **The palette speaks Obsidian**: each command shows its key, and typing an
    Obsidian command name finds the Pensée one ("Open today's daily note" →
    Today; "Toggle reading view" → a row saying Pensée has no reading view).
11. **A "Coming from Obsidian" page** in the docs and in Settings: the five
    promises, the terminology map (Vault → workspace, Canvas → Board,
    Quick switcher / Command palette → Search, Daily notes → Today, Properties
    → Properties), and the current compatibility table, generated from the
    registry below.

### P2 — later

12. Shortcut coaching: after the user clicks something that has a key, the
    tooltip names it, a few times, then stops (Superhuman's pattern).
13. A `?` shortcut sheet that marks keys you have used (Figma's pattern).
14. Custom task statuses (`[/]`, `[-]`, `[>]`…).
15. A whole-note backlinks pane and unlinked mentions.
16. Open `.canvas` (JSON Canvas) files as boards.
17. Go-to sequences (`g p`, `g l`) as Pensée's own layer, only while no text
    field has focus. Separate decision; boards already use bare P and L.

### Not doing

- **A copying importer.** 11/18 apps copy, and copying is where links, embeds
  and folders get lost. Pensée opens in place.
- **Running Dataview or Templater in full.** Shown read-only (P0 #3); query
  features get their own spec if users ask.
- **Writing into `.obsidian/`**, ever.

## The compatibility report

Shown once, the first time a folder with `.obsidian/` opens, as a quiet
sheet over the workspace, not a wizard. Reopened from Settings → Coming from
Obsidian.

```
Opened "Research" as it is. Nothing was copied or changed.

Came along
  Today's note      Journal/ · YYYY-MM-DD · template Templates/Daily
  Pasted images     Assets/
  Your hotkeys      12 of 14 (2 clash: ⌘T, ⌘G — see Keys)

Shown, not run
  Dataview queries  12 in 5 notes
  Templater tags    3 in Templates/

Not yet in Pensée
  Canvas files      2

                                                      [ Done ]
```

- Every count opens the list of notes it counts.
- Nothing here asks for a choice; settings are changed in Settings like
  anything else.
- It reports facts about the vault, not a score. No "98% compatible".

## One registry, not scattered checks

Per [docs/consolidation.md](../docs/consolidation.md): adding the next
Obsidian feature must touch one place.

`lib/obsidian-compat.ts` lists each Obsidian feature once:

- `id`, name as Obsidian calls it, Pensée's name
- `status`: `native` | `read-only` | `not-yet` | `never`
- `detect`: how to find it in a vault (a pattern over note text, or a file)
- `spec`: the spec that covers it

That one list drives the compatibility report's counts, the "Coming from
Obsidian" table, the palette's Obsidian aliases (item 10), and the tests:

- One fixture vault, `apps/desktop/e2e/fixtures/obsidian-vault/`, holds a
  note for every registry entry and a real `.obsidian/` folder.
- A unit test fails when a registry entry has no fixture note.
- A journey opens the fixture vault and checks that every `native` entry
  renders, every `read-only` entry is visible, and that `.obsidian/` is
  byte-for-byte unchanged afterwards.

Keys work the same way: each command is defined once with an id and its
default keys; `hotkeys.json` import and user changes are both a diff keyed by
command id, so a key is never set in two places.

## Open questions

1. For the ~10 keys that still differ from Obsidian, does `hotkeys.json`
   import plus rebinding settle it, or should there be an "Obsidian exactly"
   option that gives ⌘T, ⌘G, ⌘[ / ⌘] and ⌘E back to Obsidian's meanings?
2. Nested tags: [tags-spec.md](tags-spec.md) rules them out; Obsidian vaults
   use them. Read them at least?
3. Does the `.obsidian/` reader follow changes the user makes in Obsidian
   while Pensée is open, or read once per vault open?

## Sources

- Obsidian Importer, Logseq flow: https://obsidian.md/help/import/logseq
- Capacities, switching from Obsidian: https://docs.capacities.io/migration/switching-from-obsidian
- Zettlr, migrating from Obsidian: https://docs.zettlr.com/en/getting-started/migrating-from-obsidian.html
- NotePlan, importing from Obsidian: https://help.noteplan.co/article/216-how-to-import-notes-from-obsidian
- Anytype, migrating from Obsidian: https://doc.anytype.io/anytype-docs/advanced/data-and-security/import-export/migrate-from-obsidian
- Linear, coming from Jira: https://linear.app/enablement/guide/coming-from-jira
- Zed base keymaps: https://zed.dev/docs/key-bindings
- JetBrains keymaps and moving from VS Code: https://www.jetbrains.com/help/idea/configuring-keyboard-and-mouse-shortcuts.html
- VS Code keybindings: https://code.visualstudio.com/docs/configure/keybindings
- Raycast hotkeys and conflicts: https://manual.raycast.com/command-aliases-and-hotkeys.md
- Obsidian hotkeys: https://obsidian.md/help/hotkeys
- Figma shortcuts panel: https://help.figma.com/hc/en-us/articles/360040328653
