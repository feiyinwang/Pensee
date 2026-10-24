import { describe, expect, it } from "vite-plus/test";

import { checkMonthPaintings, MONTH_PAINTINGS, type MonthPainting } from "./changelog-paintings";

const painting = (by: string, title: string, src = `/paintings/${title}.webp`): MonthPainting => ({
  src,
  focus: "50% 50%",
  by,
  title,
  year: "1660",
});

describe("checkMonthPaintings", () => {
  it("passes the site's own months and paintings", () => {
    expect(() => checkMonthPaintings(Object.keys(MONTH_PAINTINGS))).not.toThrow();
  });

  it("names a month that has no painting", () => {
    expect(() => checkMonthPaintings(["2026-11", "2026-10"])).toThrow(/2026-11 with no painting/);
  });

  it("refuses a painting on two months", () => {
    const twice = {
      "2026-10": painting("Gabriel Metsu", "A"),
      "2026-09": painting("Gabriel Metsu", "A"),
    };
    expect(() => checkMonthPaintings(["2026-10", "2026-09"], twice, [])).toThrow(
      /already used for 2026-10/,
    );
  });

  it("refuses a painting that hangs elsewhere on the site, whatever its painter is called", () => {
    const months = { "2026-10": painting("Rembrandt van Rijn", "Philosopher in Meditation") };
    const site = [{ by: "Rembrandt", title: "Philosopher in Meditation" }];
    expect(() => checkMonthPaintings(["2026-10"], months, site)).toThrow(/elsewhere on the site/);
  });
});
