#!/usr/bin/env bash
# Films README GIFs from a debug e2e build of the current tree and puts them
# in assets/readme/. Each scene gets a freshly seeded demo vault and its own
# app launch. The app comes to front while it films: hands off the keyboard
# and mouse until it is done, or your keys land in the note.
#
#   e2e/readme-gifs/film.sh pen book            # build, then film and stitch these
#   e2e/readme-gifs/film.sh --no-build youtube  # reuse the last build
#   e2e/readme-gifs/film.sh --stitch-only podcast  # re-stitch the last frames
#   e2e/readme-gifs/film.sh all                 # every scene
#
# Scenes: check, connect, pen, book, youtube, podcast, dock (it("…") names in scenes.spec.js).
# Frames are kept in $FRAMES (default: $TMPDIR/pensee-readme-gifs) so a GIF
# can be re-stitched with another crop without filming again.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
E2E_DIR="$HERE/.."
TAURI_DIR="$E2E_DIR/../src-tauri"
OUT_DIR="$E2E_DIR/../../../assets/readme"
# PENSEE_E2E_APP films another debug e2e build (another checkout's, with --no-build).
APP="${PENSEE_E2E_APP:-$TAURI_DIR/target/debug/bundle/macos/Pensée.app/Contents/MacOS/desktop}"
FRAMES="${FRAMES:-${TMPDIR:-/tmp}/pensee-readme-gifs}"
export PATH="$HOME/.cargo/bin:$HOME/.vite-plus/bin:$PATH"
ALL=(check connect pen book youtube podcast dock)

# How each scene is stitched: GIF width, then stitch.py options. YouTube and
# the podcast are cropped to the player and the lines under it, as the spec
# measured them (@notes), and stop before the pin click.
stitch_args() {
  case "$1" in
    check | connect | pen | book | dock) echo "--width 1200" ;;
    youtube) echo "--width 1000 --crop @notes --until pin-click" ;;
    podcast) echo "--width 1000 --crop @notes --until pin-click" ;;
    *) echo "Unknown scene: $1 (scenes: ${ALL[*]})" >&2; return 1 ;;
  esac
}

build=1
film=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) build=0; shift ;;
    --stitch-only) build=0; film=0; shift ;;
    *) break ;;
  esac
done
[[ $# == 0 ]] && { sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
[[ $1 == all ]] && set -- "${ALL[@]}"
for scene in "$@"; do stitch_args "$scene" >/dev/null; done

if [[ $film == 1 ]]; then
  # Same build as e2e/qa/run.sh: debug, so the release artifacts stay put.
  if [[ $build == 1 || ! -x "$APP" ]]; then
    (cd "$TAURI_DIR" && vp exec tauri build --debug --features e2e --bundles app \
      --config '{"identifier":"com.pensee.app.e2e"}')
  fi
  # One WebDriver run per machine (qa-checklist.md harness notes).
  if pgrep -f "^node .*[w]dio(\.js)? run" >/dev/null; then
    echo "Another e2e run is going; wait for it to finish." >&2
    exit 1
  fi
  pkill -f tauri-webdriver 2>/dev/null || true
  if holder=$(lsof -nP -iTCP:4445 -sTCP:LISTEN -Fp 2>/dev/null | head -1) && [[ -n $holder ]]; then
    echo "Port 4445 is held by another app (pid ${holder#p}); quit it, then rerun." >&2
    exit 1
  fi
  echo "Filming ${*}: hands off the keyboard and mouse until it's done."
  sleep 3
fi

for scene in "$@"; do
  if [[ $film == 1 ]]; then
    node "$HERE/seed-demo.mjs"
    rm -rf "${FRAMES:?}/$scene"
    (cd "$E2E_DIR" && FRAMES="$FRAMES" PENSEE_E2E_APP="$APP" pnpm exec wdio run ./wdio.conf.js \
      --spec "$HERE/scenes.spec.js" --mochaOpts.grep "README GIFs $scene\$" --mochaOpts.timeout 300000)
  fi
  [[ -d "$FRAMES/$scene" ]] || { echo "No frames for $scene in $FRAMES" >&2; exit 1; }
  # shellcheck disable=SC2046
  python3 "$HERE/stitch.py" "$FRAMES/$scene" "$OUT_DIR/$scene.gif" $(stitch_args "$scene")
done
echo "Look at each GIF before committing it: the last frames show the note as it ended."
