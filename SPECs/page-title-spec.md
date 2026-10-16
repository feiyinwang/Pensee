# Page title

## Problem

A page's title was its first line when that line was a `# ` heading (or its frontmatter `title:`). Writing an H1 at the top of a note renamed it everywhere — tab, sidebar, ⌘F, recents — and every new note started as `# ` so the title had to be typed into the body. The title and the body's first heading were the same thing.

## Behaviour

- Every note shows a **title row** above its properties and body: the file name (without `.md`), large and bold (2× the editor font size, weight 700, above the body H1's 1.6em). Long names wrap.
- Editing the title renames the file, through the same write path as renaming in the sidebar (`renameFileStem`). Enter, ↓ at the end of the title, or clicking away renames; Escape keeps the old name. A name that is taken or invalid is refused with the sidebar's alert, and the title shows the name the file still has. An empty title keeps the old name.
- Enter and ↓ continue into the body at its start; ↑ on the body's top visual line goes back to the title. A wrapped first line moves up line by line first.
- A `# ` heading in the body is just a heading. It never becomes the title.
- The title shown elsewhere (tabs, sidebar, ⌘F, recents, window) is the frontmatter `title:` when present, else the file name. A daily note (`YYYY-MM-DD.md`) keeps its date.
- New notes start empty (`create_file` writes `""`, not `# `). Pages made from a wiki link start empty; pages made by **Move selection to page** hold only the moved text.
- Existing notes are not rewritten: a note that starts with `# Same as its name` shows that heading under the title until the writer deletes it.

## Implementation

- `apps/desktop/src/components/editor-area/page-title.tsx` / `page-title.css`: the title row (a textarea sized by a hidden copy of its text in the same grid cell) and `pageTitleArrowUp` (a `Prec.high` keymap, registered in `editor-extensions.ts`).
- `editor-pane.tsx` mounts `<PageTitle key={path} …>` above `FrontmatterPanel`; the key remounts it after a rename.
- `lib/frontmatter.ts` `inferTitle(frontmatter, path)` reads only `title:`; `editor-store.ts` no longer re-derives the title on every body edit.
- Rust `commands/fs.rs` `extract_title` reads only `title:`; `create_file_impl` writes an empty file.
- `lib/wiki-pages.ts` `newPageContent(body)` no longer prepends `# <name>`.

## Follow-ups

- A note whose frontmatter `title:` differs from its file name shows the file name in the title row and `title:` in the tab. Decide whether the title row should show and edit `title:` in that case.
- The `create-project-note` test's mock of `create_file` still writes `# `; harmless, since the project note is written over it.
