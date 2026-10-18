#!/usr/bin/env bash
# Run the user-journey specs (docs/qa/user-journeys.md) against a debug e2e
# build of the current tree, on a freshly seeded QA vault.
#
#   e2e/qa/run.sh                      # build, then every journey spec
#   e2e/qa/run.sh calendar             # build, then specs/journeys/calendar.spec.js
#   e2e/qa/run.sh --no-build calendar  # reuse the last build (frontend unchanged)
#   e2e/qa/run.sh --only CAL-02,ED-01  # build, then just those journeys
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
only=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) build=0; shift ;;
    --only) only="${2:?--only needs journey IDs, e.g. CAL-02,ED-01}"; shift 2 ;;
    *) break ;;
  esac
done

# --only: run just the it("<ID> …") journeys named, from the files that hold them.
grep_args=()
if [[ -n $only ]]; then
  pattern="\\b(${only//,/|})\\b"
  [[ $# == 0 ]] && set -- $(cd "$E2E_DIR/specs/journeys" && grep -lE "it\\(\"[^\"]*$pattern" *.spec.js | sed 's/\.spec\.js$//')
  if [[ $# == 0 ]]; then
    echo "No journey spec has an it(\"…\") for: $only" >&2
    exit 1
  fi
  grep_args=(--mochaOpts.grep "$pattern")
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
# An e2e app left running (from this or another worktree) keeps the app-side
# WebDriver port, and the specs then drive its old build instead of this one.
if holder=$(lsof -nP -iTCP:4445 -sTCP:LISTEN -Fn -Fp 2>/dev/null | head -1) && [[ -n $holder ]]; then
  pid=${holder#p}
  echo "Port 4445 is held by another app (pid $pid):" >&2
  ps -o command= -p "$pid" >&2 || true
  echo "Quit it, then rerun." >&2
  exit 1
fi
cd "$E2E_DIR"
# wdio.conf.js reseeds the QA vault (qa/seed-vault.mjs) before every spec file.
PENSEE_OBSIDIAN_CONFIG="$HOME/Library/Application Support/com.pensee.app.e2e/obsidian.json" \
  PENSEE_QA_SEED=1 PENSEE_E2E_APP="$APP" pnpm exec wdio run ./wdio.conf.js "${specs[@]}" ${grep_args[@]+"${grep_args[@]}"}
