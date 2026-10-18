#!/bin/bash
# Installs the latest Pensée release on an Apple Silicon Mac:
#
#   curl -fsSL https://raw.githubusercontent.com/feiyinwang/Pensee/master/install.sh | bash
#
# It downloads the app from the project's GitHub Releases into /Applications
# (or ~/Applications when /Applications isn't writable) and clears macOS's
# quarantine flag, because Pensée isn't notarized by Apple. Run it again to
# update. PENSEE_INSTALL_DIR picks another folder.
set -euo pipefail

REPO="feiyinwang/Pensee"
BUNDLE_ID="com.pensee.app"

fail() { echo "Pensée: $1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "Pensée runs on macOS only."
[ "$(uname -m)" = "arm64" ] || fail "this build is for Apple Silicon Macs (M1 and later)."

DEST="${PENSEE_INSTALL_DIR:-/Applications}"
if [ -z "${PENSEE_INSTALL_DIR:-}" ] && [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
fi
mkdir -p "$DEST"

echo "Finding the latest Pensée release..."
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
  grep -o '"browser_download_url": *"[^"]*-arm64\.zip"' | head -1 | sed 's/.*"\(https[^"]*\)"$/\1/')
[ -n "$URL" ] || fail "couldn't find a download in https://github.com/$REPO/releases."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "Downloading ${URL##*/}..."
curl -fL --progress-bar "$URL" -o "$TMP/Pensee.zip"
ditto -x -k "$TMP/Pensee.zip" "$TMP/unpacked"
APP=$(find "$TMP/unpacked" -maxdepth 1 -name "*.app" | head -1)
[ -n "$APP" ] || fail "the download had no app in it."

# Quit a running copy so it can be replaced.
if [ "$(osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null)" = "true" ]; then
  osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  sleep 2
fi

TARGET="$DEST/Pensée.app"
rm -rf "$TARGET"
ditto "$APP" "$TARGET"
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true

echo "Pensée is installed in $DEST. Open it with: open -a Pensée"
