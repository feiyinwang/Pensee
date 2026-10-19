// The What's new card's logic (SPECs/whats-new-card-spec.md): read the
// changelog's dated sections, pick the day to show, and pick its painting.
// Pure, so it's tested without the app.

export interface ChangelogDay {
  /** `YYYY-MM-DD`, as the section heading writes it. */
  date: string;
  /** Each entry's full markdown, joined onto one line. */
  entries: string[];
}

const DAY_HEADING = /^## (\d{4}-\d{2}-\d{2})\s*$/;

/** The changelog's dated sections, newest first. */
export function parseChangelog(markdown: string): ChangelogDay[] {
  const days: ChangelogDay[] = [];
  let day: ChangelogDay | null = null;
  for (const line of markdown.split("\n")) {
    const heading = DAY_HEADING.exec(line);
    if (heading) {
      day = { date: heading[1], entries: [] };
      days.push(day);
    } else if (line.startsWith("#")) {
      day = null;
    } else if (day && line.startsWith("- ")) {
      day.entries.push(line.slice(2).trim());
    } else if (day && line.trim() && day.entries.length > 0) {
      // A wrapped entry: its next line belongs to it.
      day.entries[day.entries.length - 1] += ` ${line.trim()}`;
    }
  }
  return days.filter((d) => d.entries.length > 0).sort((a, b) => b.date.localeCompare(a.date));
}

/** An entry's first sentence: up to the first . ! or ? that ends a sentence
 *  outside `code`, followed by a space and what can start the next one. */
export function firstSentence(entry: string): string {
  let inCode = false;
  for (let i = 0; i < entry.length; i++) {
    const ch = entry[i];
    if (ch === "`") inCode = !inCode;
    if (inCode || (ch !== "." && ch !== "!" && ch !== "?")) continue;
    // A closing ** or _ right after the stop belongs to this sentence.
    const close = /^[*_]+/.exec(entry.slice(i + 1))?.[0] ?? "";
    const rest = entry.slice(i + 1 + close.length);
    if (rest === "" || /^ [^a-z0-9]/u.test(rest)) return entry.slice(0, i + 1 + close.length);
  }
  return entry;
}

export type InlinePart = { kind: "text" | "code" | "em"; text: string };

/** Markdown inside an entry, as the card draws it: `code` stays code,
 *  _italic_ stays italic, **bold** and [link](url) become their plain text. */
export function inlineParts(markdown: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /`([^`]+)`|\*\*(.+?)\*\*|(?<![\w])_(.+?)_(?![\w])|\[([^\]]+)\]\([^)]*\)/g;
  let last = 0;
  for (const match of markdown.matchAll(pattern)) {
    if (match.index > last) parts.push({ kind: "text", text: markdown.slice(last, match.index) });
    if (match[1] !== undefined) parts.push({ kind: "code", text: match[1] });
    else if (match[3] !== undefined) parts.push({ kind: "em", text: match[3] });
    else parts.push({ kind: "text", text: match[2] ?? match[4] });
    last = match.index + match[0].length;
  }
  if (last < markdown.length) parts.push({ kind: "text", text: markdown.slice(last) });
  return parts;
}

export type UnseenResult =
  /** Show this day. */
  | { show: ChangelogDay }
  /** Nothing to show; remember this date as seen (a first run). */
  | { record: string }
  | null;

/** The day the card should show, given the last day the writer saw. A first
 *  run (nothing seen yet) shows nothing and starts from today's newest day. */
export function unseenDay(days: ChangelogDay[], lastSeen: string | null): UnseenResult {
  const newest = days[0];
  if (!newest) return null;
  if (lastSeen === null) return { record: newest.date };
  return newest.date > lastSeen ? { show: newest } : null;
}

/** "2026-10-18" → "October 18". */
export function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Which of `count` paintings a day gets: the same day always gets the same one. */
export function paintingIndex(date: string, count: number): number {
  let hash = 0;
  for (const ch of date) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % count;
}

/** `0.7.0` → [0, 7, 0]. A suffix after the numbers (`-beta`) is ignored. */
function versionParts(version: string): number[] {
  const numbers = /^v?(\d+(?:\.\d+)*)/.exec(version.trim())?.[1];
  if (!numbers) throw new Error(`Not a version: "${version}"`);
  return numbers.split(".").map(Number);
}

/** Whether `latest` is a later version than `current` (`0.10.0` > `0.9.2`). */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = versionParts(latest);
  const b = versionParts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** Whether the card should come up on its own for a release the app can
 *  update to: one the writer hasn't already closed the card for. */
export function isUnseenRelease(release: string, releaseSeen: string | null): boolean {
  return releaseSeen === null || isNewerVersion(release, releaseSeen);
}
