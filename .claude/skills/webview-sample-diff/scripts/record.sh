#!/usr/bin/env bash
# Samples the page process's stacks every 1ms and keeps its main thread.
# Usage: record.sh <out-dir> <label> [seconds=60] [pid]
# Writes <out-dir>/<label>.txt (the whole sample) and <label>.main.txt (main thread).
set -euo pipefail
dir="$1"; label="$2"; secs="${3:-60}"
here="$(cd "$(dirname "$0")" && pwd)"
pid="${4:-$("$here/find-page.sh")}"
mkdir -p "$dir"
sample "$pid" "$secs" 1 -file "$dir/$label.txt" >/dev/null 2>&1 || {
  echo "sample failed: is pid $pid still running? (it changes on every relaunch)" >&2
  exit 1
}
python3 -I "$here/main-thread.py" "$dir/$label.txt" "$secs" > "$dir/$label.main.txt"
echo "$dir/$label.main.txt (pid $pid, ${secs}s)"
