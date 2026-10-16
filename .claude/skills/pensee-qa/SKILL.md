---
name: pensee-qa
description: QA pass for Pensée. Run after every change to apps/desktop/ and before committing it. Picks the user journeys the change can reach (docs/qa/user-journeys.md), drives the real app through them with the e2e journey specs, times every action against its speed budget and baseline (docs/qa/performance.md), fixes what fails or got slower, and reports. Also use when adding a feature, to record its journeys. Triggers on: QA, check it still works, regression, performance, slow, snappy, lag, user journey, before commit, new feature, it used to work.
---

# Pensée QA

Two jobs. Pick by what just happened:

```
Did this task add a feature or change what a feature does?
├── Yes → Job A (record its journeys), then Job B
└── No  → Job B
```

Run Job B on every change to `apps/desktop/`, every time, before the commit.
The user asked for this after features they relied on broke silently. A
skipped pass is how that happens, so "it's a small change" is not a reason to
skip. Only step 0 of the checklist decides a skip.

The pass is scoped, not exhaustive: run only the journeys whose Code paths
this task's change touches (checklist step 2). Journeys the change can't reach
are not run, ★ included. The user asked for this because full passes cost too
much time for what they prove.

## Job A: record the feature's journeys

In `docs/qa/user-journeys.md`, in the same commit as the feature:

1. Add a `##` section from the template at the end of that file, or add rows
   to the feature's existing section.
2. **Feature**: one or two sentences in the user's words, saying what they can
   now do. **Code**: every path a later change could break it from.
3. One row per thing the user will do. Write Expected as what they see or
   what is on disk ("the note opens beside", "`Status:` changes in the file"),
   never "works".
4. Mark the one journey that must never break with ★.
5. Write the specs in `apps/desktop/e2e/specs/journeys/<area>.spec.js` as
   `it("<ID> …")`, and set Check to `auto: <area>`. A journey only the user can
   drive is `you`.

IDs are never reused or renumbered. When behaviour changes, edit the row's
Expected in the same commit. A stale row fails the next pass, or worse, passes
while checking the wrong thing.

## Job B: the QA pass

Follow `docs/qa/qa-checklist.md` steps 0–6 in order. Read it every run: its
harness notes change as new traps are found.

Strict points that are easy to get wrong:

- Run the picked journeys with `apps/desktop/e2e/qa/run.sh --only <IDs>`,
  which rebuilds the app. Use `--no-build` only when no app file changed since
  the last build.
- A failing journey is fixed in this task, then every picked journey is rerun.
- Never weaken a spec's expectation to make it pass. If Expected is wrong
  (the behaviour changed on purpose), change the row in user-journeys.md
  first, then the spec.
- Every pass runs all the speed journeys too (`--only <IDs>,PERF`), whatever
  the change touched, and follows `docs/qa/performance.md`. The user's rule:
  the app always feels instant, and a change that makes any action slower
  than its baseline is fixed in the same task, even under budget. Never
  raise a budget or rewrite a baseline to make a run pass.
- Never write "pass" for a journey you didn't run. `manual` and `you` rows go
  in the report as not checked.
- When a harness trick was needed (an event the plugin doesn't send, a
  selector trap), add one line to the checklist's Harness notes.

The pass ends with the report block from checklist step 6, and the `QA:` and
`Speed:` lines go in the commit message.
