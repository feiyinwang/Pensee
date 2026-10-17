# Add to Projects Spec

## Summary

Select sentences in any note, right-click, **Add to Projects** (the menu's first item whenever text is selected). Claude reads the selection and makes a project note for each project in it, so ideas written in passing land on the Projects board (SPECs/project-views-spec.md) without retyping them.

Why: plans get written in daily notes and meeting notes first. Copying each into Projects by hand is the step that gets skipped.

## What counts as a project

A project is anything that takes **more than two steps**. A sentence that is one or two steps (a single to-do, "call Sam and send the deck") is not a project, and no note is made for it.

## How the selection is split

The selection is numbered sentence by sentence (the pen's `organizeSentences`: list markers, task boxes and heading marks dropped). Claude answers which sentences make which project:

- **One project per sentence** when each sentence is its own project.
- **One project for several sentences** when they describe the same project (three sentences about one launch make one project, not three).
- Sentences that are not projects are left out.

## Names

- A name the writer already gave is kept exactly: a `[[link]]`, a bold lead, a heading, or a name before a colon or dash ("Website redesign: …" → **Website redesign**).
- Otherwise Claude names it in 1 to 5 words close to what the sentences mean, in the note's language.

## What is written

Each project goes through the same path as **Add project** on the board, so nothing is duplicated:

- A project note with that name already in the vault is left as it is and counted as already in Projects.
- Any other note with that name becomes a project (`adoptProjectNote`); one with another `Type` is only taken after the same confirm the board asks.
- Only a name no note has makes a new note (`createProjectNote`), from the vault's project template when it has one. The new note's body starts with the writer's own sentences, unchanged, then the template's body.
- Every project added here lands in **No status**: an empty `Status`, which also clears a status the template or an adopted note had. A note that is already a project keeps its column.

The note the selection came from is not changed.

The new note is on the board at once. `write_file` adds a markdown note the index doesn't have yet (`watcher::index_written_file`): the watcher skips the events of the app's own writes, the create among them, so before 2026-10-18 a note made in the app stayed off the board, search and spaces until the next launch (the board's own Add project hid it with an optimistic card).

## Feedback

- While Claude reads: the editor notice says **Adding to Projects…** and stays until the answer comes.
- Done: **Added 2 projects: Website redesign, Japan trip** with **Open Projects**. Sentences left out are named as a count: "1 sentence was a single task, so it's not a project."
- Nothing found: "None of this takes more than two steps, so no project was made."
- The pen busy: "The pen is still writing. Try again when it's done." (they share one Claude process).
- Errors (signed out, timeout, a reply that can't be read) say so; signed out offers sign-in as the pen does.

## Implementation

- `lib/projects-from-text.ts` — the prompt and the reply parser (`projectsPrompt`, `projectsReply`). The reply is JSON `[{"name": "…", "says": [1, 2]}]`; each sentence goes to the first project that claims it, names are cleaned of `[[ ]]`, `**` and quotes.
- `components/editor-area/add-to-projects.ts` — runs one request on the pen's channel (`penConversation`, `organizeModel()`), then writes the notes one by one.
- `editor-context-menu.ts` — **Add to Projects** is the first item, above Cut, whenever text is selected (2026-10-17: in the middle of the menu, under **Move selection to page…**, it went unseen). The text is the editor's selection, else text selected inside a widget the editor draws (a transcript, a thread, a linked block), read from the DOM selection when the menu opens.

## Journeys

PRJ-07 in [docs/qa/user-journeys.md](../docs/qa/user-journeys.md).
