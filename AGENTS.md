---
title: AGENTS
---

Pensée is a Tauri v2 desktop markdown editor: React frontend + Rust backend. It targets writers who use local-first plain-text workflows (Obsidian vaults, docs repos, personal wikis).

## This File

This is an **agent router**: concise context loaded every session. It routes the agent to relevant docs based on task intent. Deep guidelines, system rules, and review rubrics live in linked docs — not here.

## Architecture (Brief)

Stack: Tauri v2 (React + Rust)
Frontend: `apps/desktop/src/` — React, Zustand stores, CodeMirror/Prosemark editor
Backend: `apps/desktop/src-tauri/src/` — Rust IPC commands, file watcher, workspace state
Toolchain: Vite+ (`vp`) — see [docs/vite-plus.md](./docs/vite-plus.md)

Rust source structure:

- `lib.rs` — app setup, plugin registration, command registration
- `state.rs` — global app state (workspace root, file index, watcher handle)
- `error.rs` — error types serialized over IPC
- `watcher.rs` — file system watcher with debounce and self-write detection
- `commands/` — Tauri IPC handlers: `fs.rs`, `workspace.rs`, `search.rs`, `images.rs`

## Docs Index

All docs except CLAUDE.md, AGENTS.md, TODOS.md, and CHANGELOG.md live in `./docs/`. Feature specs live in `./SPECs/`.

**Workflow**

- [docs/workflows/agent-loop.md](./docs/workflows/agent-loop.md) — repeatable autonomous task execution loop
- [docs/workflows/agent-review.md](./docs/workflows/agent-review.md) — review personas, findings format, quality checklist, escalation rules
- [docs/workflows/worktrees.md](./docs/workflows/worktrees.md) — creating and managing parallel worktrees

**Guidelines**

- [docs/consolidation.md](./docs/consolidation.md) — if adding the next case touches more than one file, the structure is wrong: single source of truth, side-effect ownership, registry over per-case branches, one write path
- [docs/react-guidelines.md](./docs/react-guidelines.md) — imports, state, side effects, component structure, persistence
- [docs/zustand.md](./docs/zustand.md) — side effect timing, selectors, bail-out patterns
- [docs/editor.md](./docs/editor.md) — CodeMirror layout-model APIs, scroll-handler ownership, block-widget patterns (decoration shape, range-select to enter edit mode, posAtDOM boundary handling, button focus race, scrollSnapshot for heightmap shifts)
- [docs/vite-plus.md](./docs/vite-plus.md) — `vp` CLI usage and common pitfalls
- [docs/keyboard-shortcuts.md](./docs/keyboard-shortcuts.md) — canonical shortcut map
- [docs/arc.md](./docs/arc.md) — Arc UI (React + motion) registry installs, Pro token, and why `foundation.css` must never be imported globally
- [docs/motion.md](./docs/motion.md) — animation tokens and rules: ease-out under 180ms, springs for gesture settles, global button press scale
- [docs/design-tokens.md](./docs/design-tokens.md) — the one place every colour, font, type size, radius and shadow is set (`src/styles/tokens.css`): primitives → semantic tokens → legacy aliases, how to swap a value, `lib/design-tokens.ts` for JS that needs literals, and the test that fails on a raw value anywhere else
- [docs/brand.md](./docs/brand.md) — the logo (a Thick–Thin ¶ in a fashion-house serif cut): its two cuts, Ink/Cream colours, wordmark and lockups, the don'ts, and how to regenerate the app icon and favicon from `assets/brand/`

**QA**

- [docs/qa/user-journeys.md](./docs/qa/user-journeys.md) — every user journey that must keep working, by feature: what the feature is, the code that can break it, and how each journey is checked
- [docs/qa/qa-checklist.md](./docs/qa/qa-checklist.md) — the QA pass the `pensee-qa` skill runs after each change: pick journeys from the changed files, drive the real app with `apps/desktop/e2e/qa/run.sh`, fix failures, report; plus the e2e harness traps
- [docs/qa/performance.md](./docs/qa/performance.md) — speed rules: every action has a budget (16ms typing, 50ms show, 100ms go), a change never makes an action slower than its baseline, the PERF journeys every QA pass runs, and what usually makes Pensée slow

**Infra**

- [docs/website-deploy.md](./docs/website-deploy.md) — how to deploy the marketing website to Cloudflare Workers

**Cross-cutting**

- [TODOS.md](./TODOS.md) — task backlog and work-in-progress tracking
- [CHANGELOG.md](./CHANGELOG.md) — user-visible changes log
- [SPECs/](./SPECs/) — human-written feature and bug specs

## Hard Rules

- Check [`TODOS.md`](./TODOS.md) before starting work to see current tasks.
- Move tasks between sections (Up Next → In Progress → Done) as you work.
- For non-trivial work, create a spec in [`SPECs/`](./SPECs/) and link it from the task.
- Update [`CHANGELOG.md`](./CHANGELOG.md) when completing work.
- Load only docs relevant to the current task and scope.
- If a behavior or rule changes in practice, update the owning doc in the same task.
- In autonomous/loop mode, complete exactly one task at a time and commit immediately. Do not batch unless the user explicitly asks.
- Every session commits its task as soon as its QA pass is green, not only in loop mode. Never leave finished work uncommitted: other sessions edit this same checkout, and uncommitted work piles up in shared files (CHANGELOG, TODOS, docs) that the next session has to pick its own lines out of. Commit only your own lines: never `git add` a whole file that holds another session's edits, and never commit files another session staged.
- When coding or reviewing, follow the Engineering Guardrails below and the guidelines in linked docs.
- After every change to `apps/desktop/`, run the `pensee-qa` skill before committing: the journeys the change can reach must pass in the real app, and a failing one is fixed in the same task.
- Pensée must always feel instant. Every QA pass runs the speed journeys ([`docs/qa/performance.md`](./docs/qa/performance.md)); an action over budget or slower than its baseline is fixed in the same task.
- A new feature, or a change to what a feature does, records its user journeys and feature description in [`docs/qa/user-journeys.md`](./docs/qa/user-journeys.md) in the same commit, with journey specs in `apps/desktop/e2e/specs/journeys/`.

## Engineering Guardrails

- Prefer the smallest change that is correct, robust, and easy to reason about.
- Avoid fragile logic, hidden coupling, edge-case traps, and assumptions about incidental execution order.
- Keep async flows and shared state race-safe. Use explicit sequencing, cancellation, idempotency, or clear ownership where needed.
- Do not introduce unnecessary performance regressions. Avoid extra renders, allocations, subscriptions, scans, blocking work, or I/O unless clearly justified.
- Fail explicitly. Surface invalid states and unexpected errors clearly instead of silently swallowing them or masking them with fallback behavior.
- Preserve testability. Keep side effects at the boundaries, make dependencies explicit, and structure logic so it can be exercised in isolation when practical.
- Maintain clear boundaries, but prefer minimal designs. Split functions, hooks, or modules when responsibilities meaningfully diverge, not as a reflex.
- If a tradeoff is unavoidable, call it out explicitly and choose the option with the lowest long-term correctness and maintenance risk.
- When a fix doesn't work after one iteration, add a debug log before changing the approach again. Don't iterate on guesses — let the runtime tell you which term in the math is wrong.

## Validation

Frontend:

- `vp check` — format, lint, and TypeScript type checks
- `vp test` — JavaScript/TypeScript tests
- `apps/desktop/e2e/qa/run.sh [areas…]` — user-journey specs in the real app (the `pensee-qa` skill)

Rust (from `apps/desktop/src-tauri/`):

- `cargo test`
- `cargo clippy`
- `cargo fmt --check`

## Session Wrap

Wrap per [agent-loop.md](./docs/workflows/agent-loop.md). One commit per completed task with a clear message. See the existing commit history for style.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
