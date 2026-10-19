# Website Deploy

The marketing website lives in `apps/website/` and deploys to the Cloudflare Worker service `pensee-website`.

## Configuration

- Worker config: `wrangler.jsonc`
- Worker name: `pensee-website`
- Static assets directory: `apps/website/dist/client`
- Production URL: none yet. The site needs our own Cloudflare account and domain before it can deploy.

The Worker name in Cloudflare must match `name` in `wrangler.jsonc` so local deploys update the intended service.

## Deploy Locally

Deploys are run manually from a local machine using Wrangler CLI. From the repository root:

```sh
vp install
vp run website#build
vp dlx wrangler deploy --config wrangler.jsonc
```

The site sends no analytics.

Wrangler must be logged into the Cloudflare account that owns `pensee-website`:

```sh
vp dlx wrangler login
```

Verify the deployment by opening the Worker's URL that `wrangler deploy` prints.

## Notes

- Do not use GitHub Pages for this website.
- Do not rely on Cloudflare Git Builds for this website unless this document is updated first.
- Keep `wrangler.jsonc` at the repository root so local Wrangler deploys use the same Worker settings.
- Run `vp check` before deploying source changes when practical.
- The Download button links to `https://github.com/feiyinwang/Pensee/releases/latest/download/Pensee-arm64.zip`, so the browser gets the newest zip directly. That works only because `scripts/release.sh` uploads the zip a second time under that fixed name; keep the name in both places.
