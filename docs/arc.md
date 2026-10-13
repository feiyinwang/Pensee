# Arc UI

[Arc](https://uiarc.dev) is a React + `motion` component library installed through shadcn registries. Pensée uses it for board chrome (see [SPECs/board-lark-parity-spec.md](../SPECs/board-lark-parity-spec.md)) in the calendar panel (`calendar`, `dropdown-menu`), in the Projects space (`sortable-data-table`, `badge`, the Pro `kanban-board` block; see [SPECs/project-views-spec.md](../SPECs/project-views-spec.md)), and in the agent chat panel: `text-shimmer` for the thinking line, `code-block` (with `copy-button`) for code in replies (see [SPECs/agent-chat-spec.md](../SPECs/agent-chat-spec.md)).

## Installing items

From `apps/desktop/`:

```sh
pnpm dlx shadcn@latest add @uiarc/<name>        # free
pnpm dlx shadcn@latest add @uiarc-pro/<name>    # Pro
```

- **Pro items** need `ARC_PRO_TOKEN=arc_pro_…` in `apps/desktop/.env.local` (gitignored). `components.json` reads it into the `Authorization` header.
- **Where files go:** `src/components/arc/`. They are vendored. Formatting and linting skip that folder (see the root `vite.config.ts`) so they stay byte-identical to upstream. Don't hand-edit them; wrap them instead.
- **Local patches** (the only exceptions — each line is marked `Pensée patch` in the file; re-apply after reinstalling the item):
  - `dropdown-menu/dropdown-menu.tsx` — `align` and `alignOffset` props (upstream always aligns the menu to the trigger's end), so the calendar panel's view menu lines its items up under the title.
  - `calendar/calendar.tsx` + `calendar.module.css` — three props for the calendar panel ([SPECs/calendar-panel-spec.md](../SPECs/calendar-panel-spec.md)): `weekStartsOn` (Monday-first rows), `weekLabel` (a leading column, one cell per week row, whose six rows stretch to the month grid's) and `markedDates` (a dot under a day's number).
  - `blocks/kanban-board/kanban-board.tsx` + `kanban-board-data.ts` — for the Projects space ([SPECs/project-views-spec.md](../SPECs/project-views-spec.md)): a plain `img` instead of `next/image`; props `onCardOpen` (a click opens the note, not the sample drawer), `toolbar` (hide the block's own title bar), `showIds`, `noun` ("Add project"), `composer` (Projects renders its own add field, with note suggestions, in a column); a column `label` and a card `meta` (tags); no empty meta row on a card with nothing to show.
  - `segmented-control/segmented-control.tsx` + `.module.css` — a mouse press chooses an option (upstream waits for the click, on release; touch and pen still use click), and the highlight and label colour change at once, with no glide (upstream: a 0.42s `spring.morph`), no colour transition and no press scale. Switching Library tabs and Projects views is a many-times-a-day action, so any motion there read as lag.
  - `calendar/calendar.tsx` — the selected day's highlight glides on ease-out in 0.16s (`PENSEE_GLIDE`) instead of `spring.morph`'s 0.42s bounce (the composer and the calendar panel).
  - `dropdown-menu/dropdown-menu.tsx` — the trigger's width follows a new label on ease-out in 0.16s (`PENSEE_RESIZE`) instead of `spring.morph`.
  - `dock/dock.tsx` — faster tool labels, because the Dock exposes no timing props: first-label delay 60ms (upstream 380) — just enough to skip a pointer sweeping across the dock, label enter spring 0.1 (upstream 0.22), exit 100ms ease-in (upstream 180ms), glide between items 0.2 (upstream 0.3).
- **Dependencies:** every item needs `motion` and `lucide-react`. Both are installed.

## Never import `foundation.css` globally

Arc's docs say to import `@/components/arc/foundation.css` in the root layout. **Don't.** It:

- sets `--accent`, `--text-muted`, `--text-secondary`, `--ease-*` and others on `:root`, overriding Pensée's theme tokens app-wide;
- reacts to `:root[data-theme="dark"]`, which Pensée also sets;
- removes focus outlines from every element (`:is(*:focus, *:focus-visible, *:focus-within)`), which breaks keyboard focus visibility across the app.

Call `ensureArcTokens()` from `board/arc-tokens.ts` instead, from a lazy-loaded module. It injects a rewritten copy once:

- the tokens move to `body`, because Arc popovers and tooltips portal there;
- every Arc token name Pensée already defines (measured at runtime, so new Tailwind utilities are covered) keeps Pensée's value;
- the focus rule is dropped.

Arc components then pick up Pensée's accent, text colours and UI font, and nothing outside them changes. Keep Arc imports behind a dynamic `import()` so notes never pay for `motion` or Arc at startup (the agent panel is a `React.lazy` chunk for this reason).

Arc tokens Pensée does _not_ define (`--surface`, `--border`, `--foreground`, …) keep Arc's opaque neutral values. Where an Arc piece sits on Pensée's translucent glass, remap them on the container instead of editing the vendored file — see the `.agent-panel` block in `components/agent-chat/agent-chat.css`.

## Motion

Arc components keep their own motion (`motionTokens`, springs such as the popover's 580ms settle). That departs from [motion.md](./motion.md)'s "ease-out under 180ms" rule on purpose: the user chose Arc for board visuals and animation. The exception covers Arc surfaces only; Pensée's own UI still follows motion.md. Every Arc component honours `prefers-reduced-motion`.

The composer ([SPECs/composer-spec.md](../SPECs/composer-spec.md)) opts its Arc pieces out: while a composer card is mounted, `body.composer-motion` sets `--duration-spring: 180ms`, `--ease-spring: var(--ease-out)` and `--duration-standard: 160ms`, so its chips, menus and calendar (which portal to `<body>`) move on Pensée's timing. The selector is `:root:root:root:root body.composer-motion` to outrank both Arc's `:root body` tokens and the `:root:root:root body` rule that keeps Pensée's `--ease-spring`. Motion written in JS (`motionTokens` springs) ignores these tokens; the two that felt slow there are the patches above.
