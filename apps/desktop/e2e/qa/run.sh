#!/usr/bin/env bash
# Run the user-journey specs (docs/qa/user-journeys.md) against a debug e2e
# build of the current tree, on a freshly seeded QA vault.
#
#   e2e/qa/run.sh                      # build, then every journey spec
#   e2e/qa/run.sh calendar             # build, then specs/journeys/calendar.spec.js
#   e2e/qa/run.sh --no-build calendar  # reuse the last build (frontend unchanged)
#
# The debug build lives in target/debug, so it never invalidates the release
# artifacts scripts/ship-local.sh uses. It embeds the frontend, so rebuild
# after any change; an incremental build takes about a minute and a half.
set -euo pipefail

E2E_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$E2E_DIR/../src-tauri"
APP="$TAURI_DIR/target/debug/bundle/macos/Pensée.app/Contents/MacOS/desktop"
export PATH="$HOME/.cargo/bin:$HOME/.vite-plus/bin:$PATH"

build=1
if [[ "${1:-}" == "--no-build" ]]; then
  build=0
  shift
fi

if [[ $build == 1 || ! -x "$APP" ]]; then
  (cd "$TAURI_DIR" && vp exec tauri build --debug --features e2e --bundles app \
    --config '{"identifier":"com.pensee.app.e2e"}')
fi

specs=()
for name in "$@"; do specs+=(--spec "./specs/journeys/$name.spec.js"); done
[[ ${#specs[@]} == 0 ]] && specs=(--spec "./specs/journeys/*.spec.js")

# A run that died earlier can leave the WebDriver proxy holding its port.
pkill -f tauri-webdriver 2>/dev/null || true
cd "$E2E_DIR"
# wdio.conf.js reseeds the QA vault (qa/seed-vault.mjs) before every spec file.
PENSEE_QA_SEED=1 PENSEE_E2E_APP="$APP" pnpm exec wdio run ./wdio.conf.js "${specs[@]}"
