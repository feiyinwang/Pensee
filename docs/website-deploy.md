# Website Deploy

The marketing website lives in `apps/website/` and deploys to the Cloudflare Worker service `pensee-website`. Cloudflare builds and deploys it from GitHub on every push to `master` that touches the website (Workers Builds). A manual deploy from a Mac is the fallback.

## Configuration

- Worker config: `wrangler.jsonc`
- Worker name: `pensee-website`
- Static assets directory: `apps/website/dist/client` (the build prerenders every page, so the Worker only serves files)
- Production URL: https://pensee-website.zhhv5f4p77.workers.dev (live since 2026-10-19), until a custom domain is added.

The Worker name in Cloudflare must match `name` in `wrangler.jsonc`, so a Git build and a manual deploy update the same Worker.

## Git builds (the normal path)

Cloudflare's GitHub app watches `feiyinwang/Pensee`. The Worker's **Settings → Build** holds:

| Setting           | Value                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Git repository    | `feiyinwang/Pensee`, production branch `master`                                                                     |
| Root directory    | empty (the repository root, where `wrangler.jsonc` is)                                                              |
| Build command     | `pnpm install --frozen-lockfile && pnpm --filter website build`                                                     |
| Deploy command    | `pnpm dlx wrangler deploy --config wrangler.jsonc`                                                                  |
| Build watch paths | include `apps/website/**`, `assets/readme/**`, `apps/desktop/src/components/onboarding/assets/**`, `wrangler.jsonc` |

Why these:

- **pnpm, not npx.** The root `package.json` asks for Node 24.19 in `devEngines`, and npm refuses to run (`EBADDEVENGINES`) on Cloudflare's default Node 22. pnpm doesn't enforce it, and both commands were tested on Node 22 from a fresh clone (2026-10-19).
- **The whole workspace installs** (about 7 seconds with a warm store), because the website imports the README GIFs from `assets/readme/` and the book covers from the desktop app's onboarding assets.
- **Watch paths** keep app-only commits from redeploying the site. Add a path here when the website starts importing from a new folder.

**A push to `master` that touches the website publishes it.** Check the page locally before pushing:

```sh
vp run website#build
```

## Deploy manually (fallback)

From the repository root, with Wrangler logged into the Cloudflare account that owns `pensee-website`:

```sh
vp dlx wrangler login
```

```sh
vp run website#build
```

```sh
vp dlx wrangler deploy --config wrangler.jsonc
```

`wrangler login` prints a link: open it in the browser window signed into the right Cloudflare account (a private window keeps a work account untouched). Without the CLI, the dashboard's **Upload your static files** takes the `apps/website/dist/client` folder as it is.

Verify a deployment by opening the Worker's URL.

## Notes

- The site sends no analytics.
- Do not use GitHub Pages for this website.
- Keep `wrangler.jsonc` at the repository root so Git builds and manual deploys use the same Worker settings.
- Run `vp check` before pushing website source changes when practical.
- The Download button links to `https://github.com/feiyinwang/Pensee/releases/latest/download/Pensee-arm64.zip`, so the browser gets the newest zip directly. That works only because `scripts/release.sh` uploads the zip a second time under that fixed name; keep the name in both places.
