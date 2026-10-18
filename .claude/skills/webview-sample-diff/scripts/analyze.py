"""Read the main-thread trees record.sh writes.

  top     <main.txt> [--n 40] [--actions N]
          Busy time, then the heaviest frames by inclusive ms.
  diff    <before.main.txt> <after.main.txt> [--idle idle.main.txt]
          [--actions N | --before-actions N --after-actions M] [--n 25]
          The heaviest frames side by side, idle subtracted, per action.
  callers <main.txt> <frame substring> [--depth 4]
          The call paths that lead into a frame, heaviest first.

Counts in a `sample` tree are samples (one per ms at a 1ms interval) during
which that frame was on the stack. `sample` loses some samples to its own
overhead, so counts are scaled to the recording's real length.
"""

import argparse
import collections
import re

LINE = re.compile(r"^([ +!:|]*)(\d+) (.*)$")
# Waiting for work: the run loop asleep in mach_msg. Everything else is busy.
IDLE = "__CFRunLoopServiceMachPort"
# Plumbing every busy stack passes through: never the answer.
PLUMBING = re.compile(
    r"^(Thread_|start$|_?xpc|WebKit::XPCServiceMain|-\[NSRunLoop|_CFRunLoop|__CFRunLoop"
    r"|CFRunLoop|mach_msg|WTF::Detail::CallableWrapper|WTF::RunLoop::|WebCore::timerFired$"
    r"|IPC::|WebKit::AuxiliaryProcess::|\?\?\?$|<deduplicated)",
    re.IGNORECASE,
)


def frame_name(text):
    name = re.sub(r"\s+\(in [^)]*\).*$", "", text)
    name = re.sub(r"\s+\+ \d+.*$", "", name)
    # C++ frames: drop the argument list so overloads and offsets merge.
    if "::" in name:
        name = re.sub(r"\(.*$", "", name)
    return name.strip()


def load(path):
    """-> (seconds, list of (depth, count, name))"""
    seconds = None
    nodes = []
    for raw in open(path, encoding="utf-8", errors="replace"):
        raw = raw.rstrip("\n")
        if raw.startswith("# seconds="):
            seconds = float(raw.split("=", 1)[1])
            continue
        m = LINE.match(raw)
        if m:
            nodes.append((len(m.group(1)), int(m.group(2)), frame_name(m.group(3))))
    if not nodes:
        raise SystemExit(f"{path}: no call tree (was it made by record.sh?)")
    return seconds, nodes


def inclusive(nodes):
    """Samples per frame, each sample counted once per frame even when the
    frame recurses (a nested occurrence is skipped while an ancestor has it)."""
    totals = collections.Counter()
    stack = []
    for depth, count, name in nodes:
        while stack and stack[-1][0] >= depth:
            stack.pop()
        if all(name != n for _, n in stack):
            totals[name] += count
        stack.append((depth, name))
    return totals


class Recording:
    def __init__(self, path):
        self.path = path
        seconds, nodes = load(path)
        self.nodes = nodes
        self.samples = nodes[0][1]
        self.totals = inclusive(nodes)
        # ms per sample: the recording's length over the samples it caught.
        self.scale = (seconds * 1000 / self.samples) if seconds else 1.0
        self.idle_ms = self.totals[IDLE] * self.scale
        self.total_ms = self.samples * self.scale
        self.busy_ms = self.total_ms - self.idle_ms

    def ms(self, name):
        return self.totals[name] * self.scale

    def heaviest(self, n):
        rows = [(c, k) for k, c in self.totals.items() if not PLUMBING.match(k) and k != IDLE]
        rows.sort(reverse=True)
        return [k for _, k in rows[:n]]


def cmd_top(a):
    r = Recording(a.file)
    per = f", {r.busy_ms / a.actions:.0f}ms per action" if a.actions else ""
    print(f"{r.path}: {r.total_ms / 1000:.1f}s recorded, {r.busy_ms:.0f}ms busy{per}")
    for name in r.heaviest(a.n):
        line = f"{r.ms(name):8.0f}ms  {name[:150]}"
        if a.actions:
            line = f"{r.ms(name) / a.actions:7.1f}/action " + line
        print(line)


def cmd_diff(a):
    before, after = Recording(a.before), Recording(a.after)
    idle = Recording(a.idle) if a.idle else None
    nb = a.before_actions or a.actions or 1
    na = a.after_actions or a.actions or 1
    unit = "per action" if (a.actions or a.before_actions) else "total"

    def cost(rec, name, actions):
        ms = rec.ms(name) if name else rec.busy_ms
        if idle:
            # Background work runs at the idle rate for the whole recording.
            base = idle.ms(name) if name else idle.busy_ms
            ms -= base / (idle.total_ms or 1) * rec.total_ms
        return max(ms, 0) / actions

    names = []
    for name in before.heaviest(a.n) + after.heaviest(a.n):
        if name not in names:
            names.append(name)
    names.sort(key=lambda k: -max(cost(before, k, nb), cost(after, k, na)))
    print(f"ms {unit}{', idle subtracted' if idle else ''}   before   after   change")
    rows = [("BUSY (all main-thread work)", cost(before, None, nb), cost(after, None, na))]
    rows += [(k, cost(before, k, nb), cost(after, k, na)) for k in names[: a.n]]
    for name, b, f in rows:
        change = "gone" if b and f < 0.5 else ("new" if not b else f"{(f - b) / b * 100:+.0f}%")
        print(f"{b:9.1f} {f:8.1f}   {change:>6}  {name[:110]}")


def cmd_callers(a):
    _, nodes = load(a.file)
    paths = collections.Counter()
    stack = []
    for depth, count, name in nodes:
        while stack and stack[-1][0] >= depth:
            stack.pop()
        names = [n for _, n in stack]
        if a.frame in name and not any(a.frame in n for n in names):
            chain = [n for n in names if not PLUMBING.match(n)][-a.depth :]
            paths[" > ".join(chain + [name])] += count
        stack.append((depth, name))
    for path, count in paths.most_common(10):
        print(f"{count:7d}  {path[:300]}")


p = argparse.ArgumentParser()
sub = p.add_subparsers(dest="cmd", required=True)
t = sub.add_parser("top")
t.add_argument("file")
t.add_argument("--n", type=int, default=40)
t.add_argument("--actions", type=int)
t.set_defaults(run=cmd_top)
d = sub.add_parser("diff")
d.add_argument("before")
d.add_argument("after")
d.add_argument("--idle")
d.add_argument("--actions", type=int)
d.add_argument("--before-actions", type=int)
d.add_argument("--after-actions", type=int)
d.add_argument("--n", type=int, default=25)
d.set_defaults(run=cmd_diff)
c = sub.add_parser("callers")
c.add_argument("file")
c.add_argument("frame")
c.add_argument("--depth", type=int, default=4)
c.set_defaults(run=cmd_callers)
args = p.parse_args()
args.run(args)
