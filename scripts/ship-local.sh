#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="${WRITER_APP_NAME:-Writer Mine}"
SIGN_IDENTITY="${WRITER_SIGN_IDENTITY:--}"
DEST="/Applications/${APP_NAME}.app"
LOCAL_CONF="$ROOT_DIR/apps/desktop/src-tauri/tauri.local.conf.json"
ENTITLEMENTS="$ROOT_DIR/apps/desktop/src-tauri/Entitlements.plist"
BUNDLE_DIR="$ROOT_DIR/apps/desktop/src-tauri/target/release/bundle/macos"
LOCK_DIR="/tmp/writer-ship-local.lock"

STAGE_ONLY=0
[ "${1:-}" = "--stage-only" ] && STAGE_ONLY=1

notify() { osascript -e "display notification \"$1\" with title \"$APP_NAME\"" >/dev/null 2>&1 || true; }

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[ship-local] a build is already running - skipping"; exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

[ -f "$LOCAL_CONF" ] || { echo "[ship-local] missing $LOCAL_CONF"; exit 1; }

COMMIT=$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "?")
echo "[ship-local] building $APP_NAME @ $COMMIT"
notify "Building $COMMIT..."

cd "$ROOT_DIR/apps/desktop"
if ! vp exec tauri build --bundles app --config "$LOCAL_CONF"; then
  echo "[ship-local] BUILD FAILED - the installed app was left untouched"
  notify "Build failed ($COMMIT) - app unchanged"
  exit 1
fi

SRC="$BUNDLE_DIR/${APP_NAME}.app"
[ -d "$SRC" ] || { echo "[ship-local] bundle not found: $SRC"; ls -1 "$BUNDLE_DIR" || true; exit 1; }

codesign --force --deep --options runtime \
  --entitlements "$ENTITLEMENTS" \
  --sign "$SIGN_IDENTITY" "$SRC" >/dev/null 2>&1 || { echo "[ship-local] codesign failed"; exit 1; }

WAS_RUNNING=0
if pgrep -f "${DEST}/Contents/MacOS/" >/dev/null 2>&1; then
  WAS_RUNNING=1
  osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    pgrep -f "${DEST}/Contents/MacOS/" >/dev/null 2>&1 || break
    sleep 0.5
  done
fi

rm -rf "${DEST}.old"
[ -d "$DEST" ] && mv "$DEST" "${DEST}.old"
ditto "$SRC" "$DEST"
rm -rf "${DEST}.old"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "[ship-local] installed -> $DEST"
[ "$STAGE_ONLY" -eq 0 ] && [ "$WAS_RUNNING" -eq 1 ] && open -a "$DEST"
notify "Updated to $COMMIT"
