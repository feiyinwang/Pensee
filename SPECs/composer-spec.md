# Composer Spec

## Summary

One box to start anything: a note, a line for a day's note, or a Library
item. Linear's new-issue layout (destination, large title, text, and one row of
property chips, attach, a toggle and the primary button) on Writer's card
surface with Arc controls. Its content is Writer's own.

It replaces the New tab page's four links (Create new note, Today's note,
Search, Add to Library) and the palette's create and add modes. Search stays
on ⌘O / ⌘P.

## Ways in

| Way in                                    | Opens the composer…                                         |
| ----------------------------------------- | ----------------------------------------------------------- |
| ⌘T, ⌘N, the tab bar's **+**               | as it was left (an empty draft starts over as a plain note) |
| ⌘⇧N                                       | with the date chip on today                                 |
| ⌘⇧L, **Add to Library…** in ⌘O            | ready for Library: type Book until a link says otherwise    |
| A Library tab's **Add <noun>** / **+**    | with that tab's kind picked                                 |
| Drop one PDF or EPUB while it is showing  | with the file attached                                      |
| A window with no tabs (the New tab page)  | in the page itself; ⌘T puts the caret there                 |

Compact one-file windows have no workspace to file into: the composer is
inert there and ⌘N keeps the palette's create field.

## The box

- **Header:** where it goes, `[folder]`, and close at the right. No
  "New note" heading: the type chip, date chip and button already say what
  is being made. The folder chip picks where a plain note goes: the vault root, its
  top-level folders, or the open note's folder. For a day's note it shows the
  daily-note folder and for Library the vault, disabled, since those places
  are fixed.
- **Title**, then **text** that grows to 40% of the window and then scrolls.
  Enter in the title moves to the text. With a date or a file, the title shows
  the day's note name or the file's name (with ✕ to remove the file) and
  can't be edited.
- **Type chip:** Note, then Library's kinds with Library's icons. A pasted
  link sets it from the site (YouTube → Video, arXiv → Paper…, an unknown site
  → Book) unless the user picked a kind. A file allows only Book and Paper; an
  unpicked PDF reads **Book or paper** and is typed by its first pages once
  imported (SPECs/add-to-library-spec.md).
- **Date chip:** No date, or Today / Tomorrow / Yesterday / `12 Oct`, from
  Arc's calendar (weeks start Monday, as in the calendar panel). A date makes
  the text go to the end of that day's note (made if missing), a blank line
  apart. Setting a date moves a typed title to the top of the text and turns
  the type back to Note; picking a Library kind clears the date.
- **Status** in the header's right side, before close: a link already in
  Library ("Already in your Library: …"), or an error such as a name that's
  taken, with **Open it**. It never adds a line, so the box doesn't jump.
- **One row** under the text: Type, Date and the paperclip (attach a PDF or
  EPUB) on the left; **Keep open** and the button on the right. Every control
  is 28px tall on one centre line; a narrow window wraps the right pair onto
  its own line. **Keep open** saves without leaving the page, clears the
  text, keeps the chips, and shows an "Added …" notice with **Open**.
- **Button** names what happens: Create note · Add to today / Add to 12 Oct
  (Open today with no text) · Add video / Add book… · Open note (a link
  already in Library) · Add to Library (an unpicked PDF). Disabled when
  there is nothing to make, and still named for the type chip ("Add book"). ⌘↵ presses it from anywhere in the box.
- Esc closes the box and keeps the draft for the next ⌘T.

A plain note with text but no title is `Untitled` (`Untitled 2`…). A title
that's taken is refused in the box, with **Open it**; nothing is
overwritten. Library adds read the page's title from the web, so the box lets
go first and the existing notices report progress and failures.

## Motion

None on the box: it opens from the keyboard, often, so it is simply there,
like ⌘O (docs/motion.md). Arc's chips and switch keep their own motion.

## Files

- `lib/composer.ts`: the draft, what it makes, labels (pure,
  `tests/composer.test.ts`).
- `stores/composer-store.ts`: open, draft, Keep open, errors.
- `hooks/use-composer.ts`: `openComposer` (every way in), `submitComposer`
  (every write), `attachToComposer` (drops and the paperclip).
- `components/composer/`: the lazy card (`composer-card.tsx`), the dialog,
  and the inline card for the New tab page.
- Arc `switch` (installed), `dropdown-menu`, `popover`, `calendar`.

## Follow-ups

- Folders deeper than the top level (a searchable folder picker).
- A Project type with the vault's project template.
- Paste or drop a picture into the text.
