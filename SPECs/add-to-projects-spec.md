# Add to Projects Spec

## Summary

Select sentences in any note, right-click, **Add to Projects** (the menu's first item whenever text is selected). Claude reads the selection and makes a project note for each project in it, so ideas written in passing land on the Projects board (SPECs/project-views-spec.md) without retyping them.

Why: plans get written in daily notes and meeting notes first. Copying each into Projects by hand is the step that gets skipped.

## What counts as a project

A project is anything that takes **more than two steps**, judged by the work it takes in practice, not by how short the line is: "Make a Discord channel to encourage people to post" is a project (server, channels, rules, invites, keeping it going); "Call Sam" is not, and no note is made for it.

## How the selection is split

The selection is numbered item by item (`selectionItems`): a bullet (task boxes included) or a heading is one item, whole; a paragraph is one item per sentence. Claude answers which items make which project:

- **Each item is its own project** by default: the writer split them on purpose. Items for one goal are still separate projects when each is its own piece of work: a one page website, a Discord community and an email for customer questions are three projects, even for one launch.
- **Items share a project** only when one is a step, a detail or a later stage of another ("Book flights", "Book a hotel" under "Japan trip"; testing a flow after building it).
- Items that are not projects are left out.

Why (2026-10-18): the first version cut bullets into sentences, judged each by its words, and its example said "three sentences about one launch are one project". Website / Discord / support email became one project, and a second run named it differently and made a near-duplicate.

## Names

- A name the writer already gave is kept exactly: a `[[link]]`, a bold lead, a heading, or a name before a colon or dash ("Website redesign: …" → **Website redesign**).
- Otherwise Claude names it in 1 to 5 words close to what the item means, in the note's language.
- The request lists the writer's existing project names (the cached index, `list_typed_notes(["Project"], true)`, at most 300), leaving out those in **Done**: a finished project is never asked about, and a line named like one gets a project of its own (`Name 2` when the name is taken). Claude still names each project itself, and adds `same_as` when one of those may be the same piece of work, even worded differently. A name that is one of theirs counts too.

## Repeats

A project that may be one the writer has is never merged or made silently (2026-10-18: Claude reused a name on its own, and before that a second run made a near-duplicate). Before anything is written, **Already a project?** asks about each, one at a time in one popup (Arc `dialog` + `button`, `components/add-to-projects/`):

- Title **Already a project?**, with "1 of 2" under it only when there are several (the text swaps in place). No other subtitle: the card and the answers say the rest (grilled 2026-10-18).
- The writer's line, plain, then the project it may be as a card like the board's: its name, its status tag (`components/spaces/project-tag.tsx`, shared with the board) and the first lines of its note.
- **New project** (secondary) makes its own note under Claude's name, or that name with ` 2`, ` 3`… when a note has it. **Same project** (primary, focused) makes nothing; the notice lists it under **Already in Projects**.
- No × button: Esc and a click outside already close it, as **Same project** for every question left, so nothing the writer didn't ask for is made.
- The popup loads Arc and motion only when a question comes (`React.lazy`).

## What is written

Each project goes through the same path as **Add project** on the board, so nothing is duplicated:

- A project note with that name already in the vault is left as it is and counted as already in Projects.
- Any other note with that name becomes a project (`adoptProjectNote`); one with another `Type` is only taken after the same confirm the board asks.
- Only a name no note has makes a new note (`createProjectNote`), from the vault's project template when it has one. The new note's body starts with the writer's own words, unchanged (one item as written, several as a list), then the template's body.
- Every project added here lands in **No status**: an empty `Status`, which also clears a status the template or an adopted note had. A note that is already a project keeps its column.

The note the selection came from is not changed.

The new note is on the board at once. `write_file` adds a markdown note the index doesn't have yet (`watcher::index_written_file`): the watcher skips the events of the app's own writes, the create among them, so before 2026-10-18 a note made in the app stayed off the board, search and spaces until the next launch (the board's own Add project hid it with an optimistic card).

## Feedback

- While Claude reads: the editor notice says **Adding to Projects…** and stays until the answer comes.
- Done: **Added 2 projects: Website redesign, Japan trip** with **Open Projects**. Items left out are named as a count: "1 line takes two steps or fewer, so it isn't a project."
- Nothing found: "None of this takes more than two steps, so no project was made."
- The pen busy: "The pen is still writing. Try again when it's done." (they share one Claude process).
- Errors (signed out, timeout, a reply that can't be read) say so; signed out offers sign-in as the pen does.

## Implementation

- `lib/projects-from-text.ts` — the prompt and the reply parser (`projectsPrompt`, `projectsReply`). The reply is JSON `[{"name": "…", "says": [1, 2]}]`; each item goes to the first project that claims it, names are cleaned of `[[ ]]`, `**` and quotes.
- `components/editor-area/add-to-projects.ts` — runs one request on the pen's channel (`penConversation`, `organizeModel()`), then writes the notes one by one.
- `editor-context-menu.ts` — **Add to Projects** is the first item, above Cut, whenever text is selected (2026-10-17: in the middle of the menu, under **Move selection to page…**, it went unseen). The text is the editor's selection, else text selected inside a widget the editor draws (a transcript, a thread, a linked block), read from the DOM selection when the menu opens.

## Journeys

PRJ-07 in [docs/qa/user-journeys.md](../docs/qa/user-journeys.md).
