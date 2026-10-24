/**
 * What's new hangs one painting per month of the app's changelog
 * (SPECs/whats-new-card-spec.md). A painting appears once: never on two
 * months, never anywhere else on the site. A new month in CHANGELOG.md fails
 * the build until it gets a painting of its own (`checkMonthPaintings`).
 */
import { PAINTINGS as CARD_PAINTINGS } from "../../desktop/src/components/whats-new/paintings";
import { PAINTINGS as SITE_PAINTINGS } from "./content";

export interface MonthPainting {
  src: string;
  /** object-position: where the subject sits, so a crop keeps it. */
  focus: string;
  by: string;
  title: string;
  year: string;
}

/** One of the What's new card's paintings, from the same file the app bundles. */
function fromCard(by: string, title: string): MonthPainting {
  const painting = CARD_PAINTINGS.find((p) => p.artist === by && p.title === title);
  if (!painting) throw new Error(`The card has no painting "${title}" by ${by}`);
  return { src: painting.src, focus: painting.focus, by, title, year: painting.year };
}

/**
 * `YYYY-MM` → its painting. Add the next month's when its first changelog day
 * lands. Still unused on the site, from the card's own set: Dürer's "Saint
 * Jerome in His Study", Carpaccio's "The Vision of Saint Augustine", Chardin's
 * "The Philosopher Reading" and ter Borch's "Woman Writing a Letter".
 */
export const MONTH_PAINTINGS: Record<string, MonthPainting> = {
  "2026-10": {
    src: "/paintings/metsu.webp",
    focus: "40% 40%",
    by: "Gabriel Metsu",
    title: "Man Writing a Letter",
    year: "c. 1664–66",
  },
  "2026-09": fromCard("Johannes Vermeer", "Woman in Blue Reading a Letter"),
  "2026-08": fromCard("Vilhelm Hammershøi", "Dust Motes Dancing in the Sunbeams"),
};

/** A painting is the same painting under any spelling of its painter: "Rembrandt" and "Rembrandt van Rijn". */
const key = (by: string, title: string) => `${by.split(" ")[0]}|${title}`.toLowerCase();

/**
 * Throws, naming what to fix, unless every month has a painting, no two
 * months share one, and none hangs elsewhere on the site.
 */
export function checkMonthPaintings(
  months: string[],
  paintings: Record<string, MonthPainting> = MONTH_PAINTINGS,
  elsewhere: { by: string; title: string }[] = Object.values(SITE_PAINTINGS),
): void {
  const missing = months.filter((month) => !paintings[month]);
  if (missing.length > 0) {
    throw new Error(
      `What's new: CHANGELOG.md has days in ${missing.join(", ")} with no painting. Find a public-domain painting of reading, writing or thinking that the site doesn't use yet, and add it to MONTH_PAINTINGS in apps/website/src/changelog-paintings.ts.`,
    );
  }
  const taken = new Map(elsewhere.map((p) => [key(p.by, p.title), "elsewhere on the site"]));
  for (const [month, p] of Object.entries(paintings)) {
    const where = taken.get(key(p.by, p.title)) ?? taken.get(p.src);
    if (where) {
      throw new Error(
        `What's new: ${month}'s painting, ${p.by}'s "${p.title}", is already used ${where}. Every month needs a painting of its own.`,
      );
    }
    taken.set(key(p.by, p.title), `for ${month}`);
    taken.set(p.src, `for ${month}`);
  }
}
