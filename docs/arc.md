# Arc UI

[Arc](https://uiarc.dev) is a React + `motion` component library installed through shadcn registries. Writer uses it for board chrome (see [SPECs/board-lark-parity-spec.md](../SPECs/board-lark-parity-spec.md)).

## Installing items

From `apps/desktop/`:

```sh
pnpm dlx shadcn@latest add @uiarc/<name>        # free
pnpm dlx shadcn@latest add @uiarc-pro/<name>    # Pro
```

- **Pro items** need `ARC_PRO_TOKEN=arc_pro_…` in `apps/desktop/.env.local` (gitignored). `components.json` reads it into the `Authorization` header.
- **Where files go:** `src/components/arc/`. They are vendored. Formatting and linting skip that folder (see the root `vite.config.ts`) so they stay byte-identical to upstream. Don't hand-edit them; wrap them instead.
- **Dependencies:** every item needs `motion` and `lucide-react`. Both are installed.

## Never import `foundation.css` globally

Arc's docs say to import `@/components/arc/foundation.css` in the root layout. **Don't.** It:

- sets `--accent`, `--text-muted`, `--text-secondary`, `--ease-*` and others on `:root`, overriding Writer's theme tokens app-wide;
- reacts to `:root[data-theme="dark"]`, which Writer also sets;
- removes focus outlines from every element (`:is(*:focus, *:focus-visible, *:focus-within)`), which breaks keyboard focus visibility across the app.

Call `ensureArcTokens()` from `board/arc-tokens.ts` instead, from a lazy-loaded module. It injects a rewritten copy once:

- the tokens move to `body`, because Arc popovers and tooltips portal there;
- every Arc token name Writer already defines (measured at runtime, so new Tailwind utilities are covered) keeps Writer's value;
- the focus rule is dropped.

Arc components then pick up Writer's accent, text colours and UI font, and nothing outside them changes. Keep Arc imports behind a dynamic `import()` so notes never pay for `motion` or Arc at startup.

## Motion

Arc components keep their own motion (`motionTokens`, springs such as the popover's 580ms settle). That departs from [motion.md](./motion.md)'s "ease-out under 180ms" rule on purpose: the user chose Arc for board visuals and animation. The exception covers Arc surfaces only; Writer's own UI still follows motion.md. Every Arc component honours `prefers-reduced-motion`.
