# Composer Spec

## Summary

One box to start anything: a note, a line for a day's note, or a Library
item. Linear's new-issue layout (destination, large title, text, and one row of
property chips, attach and the primary button) on Pensée's card
surface with Arc controls. Its content is Pensée's own.

It replaces the New tab page's four links (Create new note, Today's note,
Search, Add to Library) and the palette's create and add modes. Search stays
on ⌘O / ⌘P.

## Ways in

| Way in                                   | Opens the composer…                                         |
| ---------------------------------------- | ----------------------------------------------------------- |
| ⌘N, the tab bar's **+**                  | as it was left (an empty draft starts over as a plain note) |
| ⌘⇧N                                      | with the date chip on today                                 |
| ⌘⇧L, **Add to Library…** in ⌘O           | ready for Library: type Book until a link says otherwise    |
| A Library tab's **Add <noun>** / **+**   | with that tab's kind picked                                 |
| Drop one PDF or EPUB while it is showing | with the file attached                                      |
| A window with no tabs (the New tab page) | in the page itself; ⌘N puts the caret there                 |

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
  Enter in the title moves to the text. With a file, the title shows the
  file's name (with ✕ to remove the file) and can't be edited.
- **Type chip:** Note, then Library's kinds with Library's icons. A pasted
  link sets it from the site (YouTube → Video, arXiv → Paper…, an unknown site
  → Book) unless the user picked a kind. A file allows only Book and Paper; an
  unpicked PDF reads **Book or paper** and is typed by its first pages once
  imported (SPECs/add-to-library-spec.md).
- **Date chip:** No date, or Today / Tomorrow / Yesterday / `12 Oct`. The
  popover (296px, 16px padding, ~37px days) is Arc's calendar (weeks start
  Monday, as in the calendar panel); picking a day closes it, and **No date**
  clears it. No time: a day is enough. It works with every type:
  - the note gets a `Date` property, `2026-10-20`; only that line is
    written, so a page's other properties keep their formatting;
  - that day's note (made if missing) gets `- [[Note]]` at its end, joining
    a list the day already ends with;
  - with a date and no title (a plain note), the text itself goes to the end
    of the day's note instead, a blank line apart; the title's placeholder
    says so.
- **Status** in the header's right side, before close: a link already in
  Library ("Already in your Library: …"), or an error such as a name that's
  taken, with **Open it**. It never adds a line, so the box doesn't jump.
- **One row** under the text: Type, Date and the paperclip (attach a PDF or
  EPUB) on the left, the button on the right. Every control is 28px tall on
  one centre line; a narrow window wraps the button onto its own line.
- **Button** names what happens: Create note · Add to today / Add to 12 Oct
  (Open today with no text) · Add video / Add book… · Open note (a link
  already in Library) · Add to Library (an unpicked PDF). Disabled when
  there is nothing to make, and still named for the type chip ("Add book").
  It shows **⌘↵** inside it.
- **⌘↵** (or the button) makes it and stays on the page: the box closes and
  an "Added …" notice offers **Open**. **⌘⇧↵** makes it and opens it. A
  day's note (Open today, Add to today), Open note (a link already in
  Library) and a podcast link always open: the writing went there, or the
  note is where the episode plays
  ([podcast-notes-spec.md](podcast-notes-spec.md)), so that is where you land.
- Esc closes the box and keeps the draft for the next ⌘N.

⌘T is not a way in: it opens today's note itself, as the sidebar's **Today**
does (made if missing), so the page is the place to write.

A plain note with text but no title is `Untitled` (`Untitled 2`…). A title
that's taken is refused in the box, with **Open it**; nothing is
overwritten. Library adds read the page's title from the web, so the box lets
go first and the existing notices report progress and failures.

## Motion

None on the box: it opens from the keyboard, often, so it is simply there,
like ⌘O (docs/motion.md). The Arc pieces inside it (chips, menus, the
calendar) move on Pensée's timing while the box shows:
ease-out, at most 180ms, instead of Arc's 580ms spring settle
(`body.composer-motion`, docs/arc.md). The calendar's selected-day glide and
the type chip's width change are 0.16s ease-out (Pensée patches in Arc).

## A floating card, not a dialog

The box is a plain card portaled to `<body>`, not a Radix dialog. A modal
Radix dialog sets `pointer-events: none` on `<body>`, and Arc's popover and
menu bring other copies of Radix's layer code: the calendar took no clicks,
closing in the wrong order left the window unclickable, and one Esc closed a
menu and the box together (or, once the dialog yielded, neither). The card's
own listeners run in the bubble phase after Radix's capture-phase layers, so
Esc closes an open menu or calendar first and the box on the next press, and
a click outside closes it while clicks in the chips' menus and calendar count
as inside.

## Files

- `lib/composer.ts`: the draft, what it makes, labels (pure,
  `tests/composer.test.ts`).
- `stores/composer-store.ts`: open, draft, busy, errors.
- `hooks/use-composer.ts`: `openComposer` (every way in), `submitComposer`
  (every write), `attachToComposer` (drops and the paperclip).
- `components/composer/`: the lazy card (`composer-card.tsx`), the dialog,
  and the inline card for the New tab page.
- Arc `dropdown-menu`, `popover`, `calendar`.

## Follow-ups

- Folders deeper than the top level (a searchable folder picker).
- A Project type with the vault's project template.
- Paste or drop a picture into the text.
