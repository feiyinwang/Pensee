#!/usr/bin/env bash
# QA receipts: the pre-commit hook lets a change to apps/desktop/ in only when
# a green QA run (or a stated manual QA) saw exactly the content being
# committed. A receipt line is "<blob id> <path>", or "deleted <path>", for a
# file that differed from HEAD when QA ran. Blob ids are content hashes, so a
# receipt still matches after other sessions commit around it, and the file is
# shared by every worktree of the repo.
#
#   receipt.sh snapshot <pathspec>…     # print lines for the changed files now
#   receipt.sh record <file>…           # add those lines to the receipts
#   receipt.sh manual "<why>"           # receipt for the current files, QA'd by hand
#   receipt.sh check                    # pre-commit: is every staged app file covered?
set -euo pipefail

cd "$(dirname "$0")" && cd "$(git rev-parse --show-toplevel)"
COMMON_DIR=$(git rev-parse --path-format=absolute --git-common-dir)
RECEIPTS="$COMMON_DIR/pensee-qa-receipts"
MANUAL_LOG="$COMMON_DIR/pensee-qa-manual.log"
APP=apps/desktop

# Files no journey can reach: prototypes, docs, the README GIF filming scripts.
exempt() {
  case "$1" in
    "$APP"/proto/* | "$APP"/e2e/readme-gifs/* | *.md) return 0 ;;
    *) return 1 ;;
  esac
}

snapshot() {
  { git diff HEAD --name-only --no-renames -z -- "$@"; git ls-files -o --exclude-standard -z -- "$@"; } |
    while IFS= read -r -d '' path; do
      if [[ -e $path ]]; then
        echo "$(git hash-object -- "$path") $path"
      else
        echo "deleted $path"
      fi
    done
}

record() {
  cat "$@" >>"$RECEIPTS"
  # Old receipts only ever cover content that is long committed.
  if (($(wc -l <"$RECEIPTS") > 20000)); then
    tail -n 10000 "$RECEIPTS" >"$RECEIPTS.tmp" && mv "$RECEIPTS.tmp" "$RECEIPTS"
  fi
}

check() {
  local missing=() path blob
  while IFS= read -r -d '' path; do
    exempt "$path" && continue
    if git cat-file -e ":$path" 2>/dev/null; then blob=$(git rev-parse ":$path"); else blob=deleted; fi
    grep -qxF -- "$blob $path" "$RECEIPTS" 2>/dev/null || missing+=("$path")
  done < <(git diff --cached --name-only --no-renames -z -- "$APP")
  ((${#missing[@]} == 0)) && return 0
  {
    echo "[pre-commit] No green QA run saw these staged app files as they are now:"
    printf '  %s\n' "${missing[@]}"
    echo "Run the pensee-qa pass (apps/desktop/e2e/qa/run.sh …) on this content, then commit."
    echo "If QA was manual only, or no journey reaches the change, say so:"
    echo "  apps/desktop/e2e/qa/receipt.sh manual \"<what you checked, or why nothing>\""
  } >&2
  return 1
}

case "${1:-}" in
  snapshot) shift; snapshot "$@" ;;
  record) shift; record "$@" ;;
  manual)
    why="${2:?manual needs the reason, e.g. receipt.sh manual \"checked the menu by hand\"}"
    tmp=$(mktemp)
    snapshot "$APP" >"$tmp"
    record "$tmp"
    printf '%s %s %s\n' "$(date '+%Y-%m-%d %H:%M')" "$(git rev-parse --short HEAD)" "$why" >>"$MANUAL_LOG"
    echo "[receipt] recorded $(wc -l <"$tmp" | tr -d ' ') files as QA'd by hand: $why"
    rm -f "$tmp"
    ;;
  check) check ;;
  *)
    sed -n '2,13p' "$0" >&2
    exit 2
    ;;
esac
