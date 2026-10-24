/**
 * The app's changelog as the What's new page shows it (SPECs/whats-new-card-spec.md):
 * the repo's CHANGELOG.md, read at build with the parser the app's What's
 * new card uses, so the page and the card always list the same days. Server
 * only: the page reaches the browser as prerendered HTML.
 */
import { Marked } from "marked";

import changelog from "../../../../CHANGELOG.md?raw";
import { firstSentence, parseChangelog } from "../../../desktop/src/lib/whats-new";
import { checkMonthPaintings } from "../changelog-paintings";
import { REPO } from "../content";

/** A month of days, newest first, under its one painting (src/changelog-paintings.ts). */
export interface ChangeMonth {
  /** `YYYY-MM`, the key of its painting and its anchor. */
  month: string;
  days: ChangeDay[];
}

export interface ChangeDay {
  /** `YYYY-MM-DD`, also the day's anchor: the card's Read all opens `/changelog/#<date>`. */
  date: string;
  changes: Change[];
}

/** An entry as HTML: its first sentence, the line the card shows, then the rest. */
export interface Change {
  lead: string;
  rest: string;
}

/** The changelog by month, newest first. Fails the build when a month has no painting of its own. */
export function changelogMonths(): ChangeMonth[] {
  const months: ChangeMonth[] = [];
  for (const day of changelogDays()) {
    const month = day.date.slice(0, 7);
    if (months[months.length - 1]?.month !== month) months.push({ month, days: [] });
    months[months.length - 1].days.push(day);
  }
  checkMonthPaintings(months.map((m) => m.month));
  return months;
}

function changelogDays(): ChangeDay[] {
  return parseChangelog(changelog).map((day) => ({
    date: day.date,
    changes: day.entries.map((entry) => {
      const lead = firstSentence(entry);
      return { lead: inline(lead), rest: inline(entry.slice(lead.length)) };
    }),
  }));
}

/** A repo-relative link (`./docs/brand.md`) points into the repo on GitHub. */
const markdown = new Marked({
  walkTokens(token) {
    if (token.type === "link" && !/^(https?:|mailto:|#)/.test(token.href)) {
      token.href = `${REPO}/blob/master/${token.href.replace(/^\.\//, "")}`;
    }
  },
});

/** Markdown on one line, as HTML. */
function inline(text: string): string {
  return markdown.parseInline(text, { async: false });
}
