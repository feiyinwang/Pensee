"""Keep only the main thread's call tree from a macOS `sample` report.

Usage: python3 -I main-thread.py <sample.txt> <seconds>  > <label>.main.txt

The first line written is `# seconds=<n>`, so analyze.py can turn sample
counts into milliseconds of the recording.
"""

import re
import sys

path, seconds = sys.argv[1], sys.argv[2]
lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
# Threads are the tree's roots: "    <count> Thread_<id> ...". The main thread
# is the one on com.apple.main-thread.
root = re.compile(r"^    \d+ Thread_")
start = next(i for i, l in enumerate(lines) if root.match(l) and "main-thread" in l)
end = next((i for i in range(start + 1, len(lines)) if root.match(lines[i])), len(lines))
print(f"# seconds={seconds}")
print("\n".join(lines[start:end]))
