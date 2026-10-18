#!/usr/bin/env bash
# Prints the pid of Pensée's page process: the WebContent process WebKit
# started for the app's window, the first one launched after the app itself.
# Usage: find-page.sh [app-binary-substring]   (default: Pensée.app/Contents/MacOS/desktop)
set -euo pipefail
app="${1:-.app/Contents/MacOS/desktop}"
app_line=$(ps -axo pid=,lstart=,command= | grep -F "$app" | grep -v grep | grep -i pens | head -1 || true)
if [[ -z $app_line ]]; then
  echo "Pensée is not running." >&2
  exit 1
fi
to_epoch() { date -j -f "%a %b %d %T %Y" "$1" +%s; }
app_pid=$(awk '{print $1}' <<<"$app_line")
app_start=$(to_epoch "$(awk '{print $2, $3, $4, $5, $6}' <<<"$app_line")")
best=""
best_start=""
while read -r pid d1 d2 d3 d4 d5 _; do
  start=$(to_epoch "$d1 $d2 $d3 $d4 $d5")
  (( start < app_start )) && continue
  if [[ -z $best || $start -lt $best_start ]]; then best=$pid; best_start=$start; fi
done < <(ps -axo pid=,lstart=,command= | grep "com.apple.WebKit.WebContent" | grep -v grep)
if [[ -z $best ]]; then
  echo "No WebContent process started after Pensée (pid $app_pid)." >&2
  exit 1
fi
echo "$best"
