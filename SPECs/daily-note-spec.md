# Daily Note Spec

## Goal

Give the new-tab page a one-press way to land in today's note, named by calendar
date so a workspace accumulates a browsable daily log without the user typing a
filename every morning.

## Behavior

- The note for a given day is `<workspace root>/<daily note folder>/YYYY-MM-DD.md`,
  where the date is the **local** calendar date (`2022-04-19`), never the UTC one.
  A user writing at 23:30 gets that day's note, not tomorrow's.
- The daily-note folder comes from the `workspace.daily-note-folder` setting
  (Workspace section, workspace scope, default empty = workspace root). Leading
  and trailing slashes and whitespace are ignored; nested folders (`Journal/Daily`)
  are allowed. Missing folders are created on first use.
- The field names a folder _inside_ the workspace, so a leading slash reads as
  "from the workspace root" (the vault convention), never as a filesystem root:
  `/Journal` is `<root>/Journal`. Values that cannot be read that way — a Windows
  drive letter, or `..` segments that climb out of the root — are rejected with an
  explicit error instead of silently writing outside the vault or silently falling
  back to the root.
- The action is create-or-open, and idempotent: the first press of the day creates
  the file with the standard new-file template (`# `) and opens it with the caret
  after the template, exactly like Create New Note; every later press that day
  opens the existing note without touching its contents.
- Entry points, all running the same action:
  - A **Today's note** button on the new-tab page, below Create new note, showing
    the `⌘T` hint in the same style as the existing rows.
  - The global `Cmd+T` shortcut, and the go key's `Cmd+G` then `T`.
  - An **Open Today's Note** command in the command palette.
- All three entry points require an open workspace, matching `Cmd+N`. In compact
  single-file windows (no workspace root) the shortcut and command are inert; the
  new-tab page does not render there.
- Failures (folder escape, filesystem errors) surface to the user with the neutral
  prefix **Failed to open today's note** rather than being swallowed.

## `@` date links

- Typing `@` at the start of a line or after whitespace/an opening bracket opens
  a completion menu with **Today**, **Tomorrow** and **Yesterday** (detail: the
  `YYYY-MM-DD` date). The text after `@` filters by label prefix; no match
  closes the menu. It never opens mid-word (`me@example.com`), inside code,
  tables, math, frontmatter or links, or without a workspace.
- Choosing an item replaces `@query` with `[[YYYY-MM-DD]]` in one dispatch, so
  one undo removes it. The link is an ordinary wiki link; following, previewing
  and auto-creating it go through the wiki-link machinery.
- A page created from a bare `[[YYYY-MM-DD]]` link (the `@` menu's or one typed
  by hand) goes in the daily-note folder rather than beside the linking note:
  `newPagePath` routes date-named pages through `resolveDailyNoteFile`, the
  same resolver Today's note uses. An escaping folder setting falls back to the
  ordinary beside-the-note rule (the error is reported by Today's note).
- Owner: `components/editor-area/date-mention.ts`, registered beside the slash
  menu in `wiki-link-extension.ts`.

## Ownership

- `apps/desktop/shared/settings.schema.json` owns the setting key, label,
  description, category, scope, normalization, and default. The generic settings
  panel renders it with no daily-note-specific frontend code.
- `apps/desktop/src/lib/daily-note.ts` owns date formatting, path resolution
  (including the containment check), and the create-or-open action, with its
  filesystem/navigation/error dependencies injected so the flow is testable
  without a Tauri host. It is the single frontend owner of daily-note errors.
- `apps/desktop/src/hooks/use-daily-note.ts` is the only store-binding layer:
  it reads the workspace root and the folder setting and hands them to the action.
- `create_file_if_missing` (`apps/desktop/src-tauri/src/commands/fs.rs`) owns the
  create-or-read decision. Keeping it in one filesystem-atomic backend call avoids
  an exists-then-create race between two windows pressing the shortcut at once,
  and reuses `create_file_impl`/`read_file_impl` rather than duplicating either.

## Tests

- TypeScript unit tests cover local-date formatting (including a late-evening
  instant that UTC would roll forward, and zero-padding), folder normalization
  (empty, nested, slash- and whitespace-padded), escape rejection (absolute and
  `..`), and the action's create-then-open, open-existing, no-workspace, and
  error-reporting paths.
- A schema test asserts the `workspace.daily-note-folder` contract.
- Rust tests cover `create_file_if_missing_impl` creating a new file with the
  template, returning existing content unchanged on a second call, and creating
  missing parent directories.
