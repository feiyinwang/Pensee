/**
 * The `@` date menu: `@today`, `@tomorrow`, `@yesterday` become a
 * `[[YYYY-MM-DD]]` link to that day's daily note.
 *
 * A completion *source* registered beside the slash menu in
 * `wiki-link-extension.ts` (CodeMirror's `override` is winner-takes-all). The
 * link is an ordinary wiki link, so following it, hovering it and creating the
 * page when it is missing all go through the wiki-link machinery; `newPagePath`
 * is what puts a missing day in the daily-note folder.
 */

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { formatDailyNoteDate } from "@/lib/daily-note";
import { getWorkspaceRoot } from "@/hooks/workspace-api";
import { CALENDAR_ICON, iconNode, inBlockedContext } from "./slash-menu";

interface DateItem {
  label: string;
  /** Days from today. */
  offset: number;
}

const ITEMS: DateItem[] = [
  { label: "Today", offset: 0 },
  { label: "Tomorrow", offset: 1 },
  { label: "Yesterday", offset: -1 },
];

const MENTION_TYPE = "date-mention";

/** The local calendar day `offset` days from `now`. `setDate` walks the local
 *  calendar, so a DST change in between cannot land on the wrong day. */
export function dayFrom(now: Date, offset: number): Date {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  day.setDate(day.getDate() + offset);
  return day;
}

export function matchingDateItems(query: string): DateItem[] {
  const q = query.toLowerCase();
  return ITEMS.filter((item) => item.label.toLowerCase().startsWith(q));
}

export const dateMentionIcon = {
  position: 15,
  render: (completion: Completion): Node | null =>
    completion.type === MENTION_TYPE ? iconNode(CALENDAR_ICON) : null,
};

function toCompletion(item: DateItem, now: Date): Completion {
  const stamp = formatDailyNoteDate(dayFrom(now, item.offset));
  return {
    label: item.label,
    detail: stamp,
    type: MENTION_TYPE,
    apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
      const insert = `[[${stamp}]]`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        userEvent: "input.complete",
      });
    },
  };
}

/**
 * `@` opens the menu only at the start of a line or after whitespace/an
 * opening bracket, so `me@example.com` never does. Without a workspace there
 * is no daily note to link to.
 */
export function dateMentionCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/(?:^|[\s([{])@[^\s@]*/);
  if (!before) return null;

  const raw = context.state.doc.sliceString(before.from, before.to);
  const at = before.from + raw.indexOf("@");
  const query = context.state.doc.sliceString(at + 1, context.pos);
  if (!getWorkspaceRoot()) return null;
  if (inBlockedContext(context)) return null;

  const now = new Date();
  const options = matchingDateItems(query).map((item) => toCompletion(item, now));
  // A stray `@` that matches nothing closes the menu rather than showing an
  // empty box.
  if (!options.length) return null;

  return { from: at, to: context.pos, options, filter: false };
}
