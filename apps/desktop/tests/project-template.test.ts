import { describe, expect, test } from "vite-plus/test";
import {
  fillTemplate,
  folderTemplates,
  formatMoment,
  isProjectTemplate,
} from "../src/lib/project-template";

describe("folderTemplates", () => {
  test("reads Templater's folder → template pairs", () => {
    const settings = JSON.stringify({
      folder_templates: [
        { folder: "/1. Project/", template: "Practical/🖨 Template/Project template.md" },
        { folder: "", template: "" },
        { folder: "x" },
      ],
    });
    expect(folderTemplates(settings)).toEqual([
      { folder: "1. Project", template: "Practical/🖨 Template/Project template.md" },
    ]);
  });

  test("nothing from settings without pairs or that aren't JSON", () => {
    expect(folderTemplates("{}")).toEqual([]);
    expect(folderTemplates("not json")).toEqual([]);
  });
});

describe("isProjectTemplate", () => {
  test("a template whose Type is Project", () => {
    expect(isProjectTemplate("---\nType: Project\nStatus: Done\n---\n# Tasks\n")).toBe(true);
    expect(isProjectTemplate("---\nType: People\n---\n")).toBe(false);
    expect(isProjectTemplate("# Tasks\n")).toBe(false);
  });
});

describe("fillTemplate", () => {
  const now = new Date(2026, 9, 12, 9, 5, 7);

  test("fills the title and dates as Templater would", () => {
    expect(
      fillTemplate(
        'A: <% tp.file.creation_date() %>\nB: <%tp.file.creation_date("YYYY-MM-DD")%>\nC: <% tp.date.now("DD/MM HH:mm:ss") %>\nD: "<% tp.file.title %>"',
        "Trip",
        now,
      ),
    ).toBe('A: 2026-10-12 09:05\nB: 2026-10-12\nC: 12/10 09:05:07\nD: "Trip"');
  });

  test("drops a tag it can't run", () => {
    expect(fillTemplate("# Notes\n<% tp.file.cursor() %>\n<%* tR += 1 %>", "Trip", now)).toBe(
      "# Notes\n\n",
    );
  });
});

describe("formatMoment", () => {
  test("leaves tokens it doesn't know as written", () => {
    expect(formatMoment(new Date(2026, 0, 2), "dddd YYYY-MM-DD")).toBe("dddd 2026-01-02");
  });
});
