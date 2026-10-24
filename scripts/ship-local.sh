#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="${PENSEE_APP_NAME:-Pensée}"
DEST="/Applications/${APP_NAME}.app"
LOCAL_CONF="$ROOT_DIR/apps/desktop/src-tauri/tauri.local.conf.json"
BUNDLE_DIR="$ROOT_DIR/apps/desktop/src-tauri/target/release/bundle/macos"
LOCK_DIR="/tmp/pensee-ship-local.lock"

STAGE_ONLY=0
[ "${1:-}" = "--stage-only" ] && STAGE_ONLY=1

notify() { osascript -e "display notification \"$1\" with title \"$APP_NAME\"" >/dev/null 2>&1 || true; }

# What the build is made from: the committed app and the CHANGELOG it embeds.
app_version() { git -C "$ROOT_DIR" rev-parse HEAD:apps/desktop HEAD:CHANGELOG.md 2>/dev/null | tr -d '\n'; }

# One build at a time. A run that finds the lock taken leaves: the holder
# checks for newer commits when its build ends and builds again. A lock whose
# holder died (a crash, a reboot) is taken over.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  holder=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  [ -n "$holder" ] || { sleep 1; holder=$(cat "$LOCK_DIR/pid" 2>/dev/null || true); }
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    echo "[ship-local] a build is already running (pid $holder) - it will pick up this commit"; exit 0
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" || { echo "[ship-local] could not take $LOCK_DIR"; exit 1; }
fi
echo $$ >"$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT

# A commit that landed after the last check, while this run still held the
# lock, was turned away: build it now.
release_and_catch_up() {
  rm -rf "$LOCK_DIR"
  trap - EXIT
  [ "$(app_version)" = "$BUILT" ] || exec "$0" ${1+"$@"}
}

[ -f "$LOCAL_CONF" ] || { echo "[ship-local] missing $LOCAL_CONF"; exit 1; }

cd "$ROOT_DIR/apps/desktop"
while :; do
  BUILT=$(app_version)
  COMMIT=$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "?")
  echo "[ship-local] building $APP_NAME @ $COMMIT"
  notify "Building $COMMIT..."

  if ! vp exec tauri build --bundles app --config "$LOCAL_CONF"; then
    echo "[ship-local] BUILD FAILED - the installed app was left untouched"
    notify "Build failed ($COMMIT) - app unchanged"
    release_and_catch_up "$@"
    exit 1
  fi
  if [ "$(app_version)" != "$BUILT" ]; then
    echo "[ship-local] the app changed while building - building again"
    continue
  fi

  SRC="$BUNDLE_DIR/${APP_NAME}.app"
  [ -d "$SRC" ] || { echo "[ship-local] bundle not found: $SRC"; ls -1 "$BUNDLE_DIR" || true; exit 1; }

  # Same identity every build, so macOS keeps the user's privacy answers.
  "$ROOT_DIR/scripts/sign-local.sh" "$SRC" || { echo "[ship-local] codesign failed"; exit 1; }

  # By bundle id: a path match misses the running app, whose path macOS spells
  # with a decomposed "é".
  BUNDLE_ID=$(sed -n 's/.*"identifier": *"\([^"]*\)".*/\1/p' "$LOCAL_CONF")
  is_running() { [ "$(osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null)" = "true" ]; }

  if is_running; then
    osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
    for _ in $(seq 1 30); do
      is_running || break
      sleep 0.5
    done
  fi

  rm -rf "${DEST}.old"
  [ -d "$DEST" ] && mv "$DEST" "${DEST}.old"
  ditto "$SRC" "$DEST"
  rm -rf "${DEST}.old"
  xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

  echo "[ship-local] installed -> $DEST"
  break
done

[ "$STAGE_ONLY" -eq 0 ] && open -a "$DEST"
notify "Updated to $COMMIT"
release_and_catch_up "$@"
