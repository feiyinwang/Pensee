# Add to Projects Spec

## Summary

Select sentences in any note, right-click, **Add to Projects**. Claude reads the selection and makes a project note for each project in it, so ideas written in passing land on the Projects board (SPECs/project-views-spec.md) without retyping them.

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
- Only a name no note has makes a new note (`createProjectNote`), from the vault's project template when it has one, with **No status**. The new note's body starts with the writer's own sentences, unchanged, then the template's body.

The note the selection came from is not changed.

## Feedback

- While Claude reads: the editor notice says **Adding to Projects…** and stays until the answer comes.
- Done: **Added 2 projects: Website redesign, Japan trip** with **Open Projects**. Sentences left out are named as a count: "1 sentence was a single task, so it's not a project."
- Nothing found: "None of this takes more than two steps, so no project was made."
- The pen busy: "The pen is still writing. Try again when it's done." (they share one Claude process).
- Errors (signed out, timeout, a reply that can't be read) say so; signed out offers sign-in as the pen does.

## Implementation

- `lib/projects-from-text.ts` — the prompt and the reply parser (`projectsPrompt`, `projectsReply`). The reply is JSON `[{"name": "…", "says": [1, 2]}]`; each sentence goes to the first project that claims it, names are cleaned of `[[ ]]`, `**` and quotes.
- `components/editor-area/add-to-projects.ts` — runs one request on the pen's channel (`penConversation`, `organizeModel()`), then writes the notes one by one.
- `editor-context-menu.ts` — **Add to Projects** sits next to **Move selection to page…**, only when there is a selection.

## Journeys

PRJ-07 in [docs/qa/user-journeys.md](../docs/qa/user-journeys.md).
