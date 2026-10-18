# Performance

Pensée has to feel instant: as close to no wait as the machine allows. This
file is the speed half of the QA pass. [qa-checklist.md](./qa-checklist.md)
step 4 runs it; the `pensee-qa` skill walks it.

Why it exists: the user's rule, 2026-10-16. Every feature added costs a little
speed somewhere, and nobody notices one slowdown at a time until the app
feels heavy. So speed is checked on every change, like a journey that can
break.

## The three rules

1. **Every action has a budget.** A median over its budget fails the pass.
2. **A change never makes an action slower.** A median slower than the
   recorded baseline (past the noise allowance below) fails the pass, even
   when it is still under budget. The change that made it slower fixes it in
   the same task: no "ship now, speed up later", no TODO.
3. **Faster locks in.** When a run beats its baseline, record the new
   baseline in the same commit, so the next change is held to the faster
   number.

The budget is the ceiling, not the goal. Aim for one frame on everything.

## Budgets

| Kind   | Budget | What it covers                                                                            |
| ------ | ------ | ----------------------------------------------------------------------------------------- |
| `type` | 16ms   | A keystroke in a note or a field: drawn in the frame it was typed in.                     |
| `show` | 50ms   | Opening or closing a palette, menu, popover or panel; a toggle; hover and press feedback. |
| `go`   | 100ms  | Opening a note, switching a space, tab or column; anything that reads from disk first.    |

Why these numbers: 16ms is one frame at 60Hz (the Mac's display is often
120Hz, 8ms a frame, so typing aims under that). Around 50ms a direct
response starts to feel late. 100ms is where an answer stops feeling
instant.

Work that can't fit in `go` (Claude, the network, imports, indexing a large
vault) never blocks: it runs async (in Rust, a worker or an idle callback),
typing and clicking stay live while it runs, and something visible answers
the click within `show` (the row, a spinner, the empty panel).

Animation never delays the answer. The new state is there in the first
frame and the motion ([motion.md](../motion.md)) plays over it; nothing waits
for an animation to end before taking input.

## The speed journeys (PERF)

In `apps/desktop/e2e/specs/journeys/perf.spec.js`. Each journey times one
action inside the page: from the input event until the answer is in the DOM,
queued work has drained (React's effects, CodeMirror's DOM flush) and style
and layout are done. Nine runs after two warm-ups; the median is judged.
WebKit's timer counts whole milliseconds, which is why the regression rule
below has a 2ms floor.
Actions are clicks and typing, never shortcut keys, so a shortcut remap
doesn't break them.

| ID      | Action                                            | Kind   | Code it covers                                                                              |
| ------- | ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| PERF-01 | A letter typed in a 1,800-line note               | `type` | `src/components/editor-area/` (extensions, decorations), `src/stores/editor-store.ts`       |
| PERF-02 | Clicking Search opens the search palette          | `show` | `src/components/command-palette/`                                                           |
| PERF-03 | Typing in search narrows the results              | `show` | `src/components/command-palette/`, `src-tauri/src/commands/search.rs`                       |
| PERF-04 | Enter on a result opens the long note             | `go`   | `src/components/editor-area/`, `src/stores/editor-store.ts`, `src-tauri/src/commands/fs.rs` |
| PERF-05 | Hiding and showing the sidebar                    | `show` | `src/components/sidebar/`, `src/components/app-layout.tsx`                                  |
| PERF-06 | Clicking Projects, Library, Files in the sidebar  | `go`   | `src/components/sidebar/`, `src/components/spaces/`, `src-tauri/src/commands/spaces.rs`     |
| PERF-07 | A drag step on a board while a dock is offered    | `type` | `src/components/editor-area/board/` (board-canvas.ts, board-spark.ts, board-render.ts)      |
| PERF-08 | A pinch between one tab and all columns (20 tabs) | `go`   | `src/components/editor-area/tab-columns.tsx`, `src/components/editor-area/` (editor panes)  |

The long note is `Notes/Long essay.md` in the QA vault
(`e2e/qa/seed-vault.mjs`): headings, prose, nested lists, tasks, quotes and
links, so the editor's decorations all run.

Baselines are in `apps/desktop/e2e/qa/perf-baseline.json`, measured on this
Mac in the debug e2e build. The debug build's Rust is slower than release
and its frontend is the same production bundle, so a budget held there has
headroom in the shipped app.

First baseline (2026-10-16): typing 4ms, Search opens 13ms, search narrows
3ms, opening the long note 32ms, sidebar 4ms, spaces 3ms. Everything is
well inside its budget; the rules below keep it there. PERF-07 (a board drag step with a dock offered) joined the same day at 1ms; the docking spark it replaced took 2–3ms. PERF-08 (a pinch between one tab and five columns) joined on 2026-10-18 at 28ms. It measures the shown editors inside the switch (22ms before, when CodeMirror measured them 50ms later in a frame of its own and its labels jumped there), and it can't see the book highlights that cost the user ~half a second per switch: those run in WebKit's rendering update, which the hidden e2e window doesn't schedule, so they were found and checked with `sample`. Later that day it went to 20 tabs (the long note and a video among them), since the user keeps ~30 open and a pinch cost every one of them: 46ms with 20 tabs, then 14ms once a pinch stopped touching hidden tabs (below, **Hidden tabs**).

Paint isn't timed (the hidden e2e window doesn't paint on schedule), and the
QA vault is small. Neither replaces trying the app: when it feels slow in the
user's own vault, see "Find the cost" below.

## In the QA pass

Every pass that runs (checklist step 0 says yes) also runs **all** the PERF
journeys: they take under a minute, and a slowdown often lands far from the
code that caused it (a store subscription added in the calendar slows
typing). Add `PERF` to the `--only` list; it matches every PERF-xx:

```bash
apps/desktop/e2e/qa/run.sh --only CAL-02,ED-01,PERF
```

Each journey logs one line:

```
PERF PERF-01 median 3.4ms, worst 5.1ms (budget 16ms, baseline 3.2ms)
```

A journey fails when its median is over budget, or when it is more than
25% **and** more than 2ms slower than its baseline (both, so a 1ms action
can't fail on timer noise).

```
A PERF journey failed
├── Over budget, or slower than baseline in code this task touched
│   └── This task made it slow: find the cost and fix it (below), rerun PERF
├── Slower in code this task didn't touch
│   └── Is another build or QA run going? (pgrep -x cargo, pgrep -x
│       tauri-webdriver, pgrep -f "^node .*[w]dio")
│       ├── Yes → wait for it to finish, rerun PERF with --no-build
│       └── No → still this task's: the cost reaches it through shared code
│                (a store, app-layout, a global listener). Find it and fix it.
└── Fails only on the first run of a fresh build, passes on a rerun
    └── Cold start noise: rerun once with --no-build; two fails in a row are real
```

Never raise a budget, loosen the regression allowance, or rewrite a
baseline to make a failing run pass. A slowdown is only accepted when the
user, told the number before and after, says the feature is worth it; then
record the new baseline with that note in the commit message.

### Recording a baseline

```bash
PENSEE_PERF_UPDATE=1 apps/desktop/e2e/qa/run.sh --no-build --only PERF
```

Writes the medians of the PERF journeys that ran into
`perf-baseline.json`. Run it when:

- a new PERF journey was added (it has no baseline yet);
- a run was faster than its baseline (the log says "faster than its
  baseline"): lock it in;
- the user agreed to a slowdown (above).

Run it on a quiet machine (no other build or QA run going), and commit the
file with the change.

### A new feature adds a PERF journey

When a task adds an action users will repeat (a new overlay, a new view, a
new space, anything on the typing path, a new list that can grow long), add
its `it("PERF-<n> …")` to `perf.spec.js` and its row to the table above in
the same commit, with the kind that fits, then record its baseline. A
feature that can't meet its kind's budget doesn't ship until it does.

## Find the cost

Before guessing, measure (CLAUDE.md: a debug log before a second fix):

1. **Narrow it in the page.** Wrap the suspect calls in
   `performance.now()` deltas and `console.log("DEBUG …")` them from the
   spec. Run the one journey with `--only PERF-0n`.
2. **Count renders.** A store change that re-renders the whole tree shows as
   many component renders per keystroke: log in the suspect component's body.
3. **When it's slow only in the user's real app** (their big vault, open
   books, hidden tabs), sample the WebContent process with macOS `sample`
   while they click, and read the main-thread tree. JS timers can't see
   WebKit's own work (2026-10-13: a hidden book's text highlights froze tab
   switches for 460ms; only `sample` found it).
4. **Before building the fix on a feature that promises to skip work**
   (`content-visibility`, `contain`, `inert`, memo, a cache), use the
   `probe-the-primitive` skill: time it alone in the app's WebKit against
   `display: none` and today's code. On 2026-10-18 `content-visibility`
   made a pinch slower (46 → 65ms) where moving the tabs cost 4ms.

## What makes Pensée slow (check the diff for these)

Each of these has slowed Pensée or a near neighbour before. Review the diff
against the list before running the journeys; it is cheaper to catch here.

- **The keystroke path.** Nothing that runs per keystroke scans the vault,
  the whole document, or waits on IPC. CodeMirror view plugins and state
  fields return early on updates they don't care about (`update.docChanged`,
  `update.viewportChanged`) and build decorations for `view.visibleRanges`,
  not the whole doc ([editor.md](../editor.md)).
- **Store subscriptions.** Select the narrowest slice; never subscribe a
  component to a whole store; memoise derived arrays and objects so a
  selector doesn't return a new value every time ([zustand.md](../zustand.md)).
- **Long lists.** A list that can pass about 100 rows (files, search
  results, highlights, recents) is virtualised.
- **Work bigger than a frame.** Debounce saves and searches off the
  keystroke. Move heavy work to Rust, a worker or `requestIdleCallback`.
  Rust commands that touch the vault are async.
- **Layout thrash.** Read layout (`getBoundingClientRect`, `offsetHeight`)
  before writing styles, never alternating in a loop.
- **Costly CSS.** Animate `transform` and `opacity` only; no
  `transition: all`; no `backdrop-filter`, `filter: blur` or large shadows
  on many elements or on anything that scrolls.
- **Hidden tabs.** Keep-alive tabs stay mounted and laid out, moved out of
  sight past the strip's clip (`tab-columns.css`), so their text is
  rendered. Work that walks a document (highlights, find, selection) skips
  hidden tabs. Hiding or showing a tab changes nothing inherited inside it:
  WebKit restyles every node under a change to `visibility`, `pointer-events`,
  `inert`, a custom property, and even `content-visibility` (measured
  2026-10-18 on 19 hidden tabs: 65–120ms each, against 4ms for moving
  them). A hidden tab keeps the layout it last showed in, so a pinch lays
  out only the tabs it shows differently.
- **Startup.** A new feature loads when first used, not at launch.
- **Long AI replies.** The pen waits for Claude's whole reply, so its time
  is mostly how much Claude writes. Ask for terse formats: an outline
  (`- Label: text [1, 2]`), not JSON with a key on every field, and nothing
  that repeats the writer's own words. Measured 2026-10-17: Organize's JSON
  took ~500 tokens and 7.5 s on a short note, the outline ~250 and 5 s.
  Turning Claude's thinking off (`--effort low`, `CLAUDE_CODE_DISABLE_THINKING`)
  was tried and dropped: it never fully stopped Haiku or Opus thinking, and
  Organize runs on Sonnet, which wrote at once in every run measured.
