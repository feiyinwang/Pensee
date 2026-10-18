#!/usr/bin/env bash
# Publishes Pensée for Apple Silicon: builds the app, signs it, zips it,
# uploads it as a GitHub Release, and points the Homebrew cask at it.
# The version comes from apps/desktop/src-tauri/tauri.conf.json; bump it there
# first. Needs `gh` signed in to the account that owns both repos.
#
#   scripts/release.sh             # build, then publish
#   scripts/release.sh --no-build  # publish the last build
#
# People install the result with the cask or with install.sh (see README).
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO="feiyinwang/Pensee"
TAP="feiyinwang/homebrew-tap"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT_DIR/apps/desktop"
CONF="$DESKTOP/src-tauri/tauri.conf.json"
# Its own target dir, so a release never shares (or invalidates) the local
# builds in target/ that ship-local.sh makes.
DIST="$DESKTOP/src-tauri/target-dist"

VERSION=$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' "$CONF")
[ -n "$VERSION" ] || { echo "[release] no version in $CONF"; exit 1; }
TAG="v$VERSION"
APP="$DIST/release/bundle/macos/Pensée.app"
ZIP="$DIST/Pensee-$VERSION-arm64.zip"

if [ "${1:-}" != "--no-build" ]; then
  echo "[release] building Pensée $VERSION"
  # Rust keeps source paths in the binary (panic messages); remap them so a
  # public download doesn't carry the builder's home folder or username.
  (cd "$DESKTOP" && CARGO_TARGET_DIR="$DIST" \
    RUSTFLAGS="--remap-path-prefix=$HOME=~ --remap-path-prefix=$DESKTOP=." \
    vp exec tauri build --bundles app)
fi
[ -d "$APP" ] || { echo "[release] no build at $APP"; exit 1; }

# The same identity as local builds, so macOS keeps a user's privacy answers
# from one release to the next. Not notarized: install.sh and the cask clear
# the quarantine flag that would otherwise make Gatekeeper refuse it.
"$ROOT_DIR/scripts/sign-local.sh" "$APP"
codesign --verify --deep --strict "$APP"

rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
SHA=$(shasum -a 256 "$ZIP" | cut -d' ' -f1)
echo "[release] $ZIP ($SHA)"

if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$ZIP" -R "$REPO" --clobber
else
  gh release create "$TAG" "$ZIP" -R "$REPO" --title "Pensée $VERSION" \
    --notes "Pensée $VERSION for Apple Silicon Macs (M1 and later). Install with \`brew install --cask feiyinwang/tap/pensee\`, or see the README."
fi

# Point the cask at this release.
TAP_DIR=$(mktemp -d)
trap 'rm -rf "$TAP_DIR"' EXIT
gh repo clone "$TAP" "$TAP_DIR" -- --quiet
CASK="$TAP_DIR/Casks/pensee.rb"
sed -i '' -e "s/^  version \".*\"/  version \"$VERSION\"/" -e "s/^  sha256 \".*\"/  sha256 \"$SHA\"/" "$CASK"
if git -C "$TAP_DIR" diff --quiet; then
  echo "[release] cask already at $VERSION"
else
  git -C "$TAP_DIR" commit -qam "Pensée $VERSION"
  git -C "$TAP_DIR" push -q
  echo "[release] cask updated to $VERSION"
fi
echo "[release] done: https://github.com/$REPO/releases/tag/$TAG"
