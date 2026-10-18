import { describe, expect, test } from "vite-plus/test";
import { projectsPrompt, projectsReply, selectionItems } from "../src/lib/projects-from-text";

const TEXT = [
  "- Website redesign: move to the new CMS, redo the nav, launch by June.",
  "- Plan the Japan trip with flights, hotels and a rail pass. Call Sam.",
  "",
  "**Garden**: dig the beds, plant bulbs, set up watering.",
].join("\n");

describe("selectionItems", () => {
  test("a bullet is one item, whole; a paragraph is one item per sentence", () => {
    expect(selectionItems(TEXT).map((s) => s.text)).toEqual([
      "Website redesign: move to the new CMS, redo the nav, launch by June.",
      "Plan the Japan trip with flights, hotels and a rail pass. Call Sam.",
      "**Garden**: dig the beds, plant bulbs, set up watering.",
    ]);
    expect(selectionItems("Build the site. Then test it.").map((s) => s.text)).toEqual([
      "Build the site.",
      "Then test it.",
    ]);
  });

  test("the three bullets that once became one project stay three items", () => {
    const bullets = [
      "- Make a simple one page website. put online.",
      "- Make a discord channel to encourage people to post",
      "- [ ] Make a email for people to directly email to me about the problems.",
      "## Launch",
    ].join("\n");
    expect(selectionItems(bullets).map((s) => s.text)).toEqual([
      "Make a simple one page website. put online.",
      "Make a discord channel to encourage people to post",
      "Make a email for people to directly email to me about the problems.",
      "Launch",
    ]);
  });
});

describe("projectsPrompt", () => {
  test("numbers the items and states the rules", () => {
    const prompt = projectsPrompt(selectionItems(TEXT));
    expect(prompt).toContain(
      '<item n="2">Plan the Japan trip with flights, hotels and a rail pass. Call Sam.</item>',
    );
    expect(prompt).toContain("more than two steps");
    expect(prompt).toContain("Each item is its own project");
    expect(prompt).toContain("keep their name exactly as written");
    expect(prompt).not.toContain("<projects>");
  });

  test("carries the writer's projects so one there isn't made twice", () => {
    const prompt = projectsPrompt(selectionItems(TEXT), ["One page website launch", "Garden"]);
    expect(prompt).toContain("<projects>\nOne page website launch\nGarden\n</projects>");
  });
});

describe("projectsReply", () => {
  const items = selectionItems(
    [
      "- Website redesign: move to the new CMS, redo the nav, launch by June.",
      "- Plan the Japan trip with flights, hotels and a rail pass.",
      "- Call Sam.",
      "- **Garden**: dig the beds, plant bulbs, set up watering.",
    ].join("\n"),
  );

  test("takes each project's items and counts the ones left out", () => {
    const reply =
      '```json\n[{"name": "Website redesign", "says": [1]}, {"name": "Japan trip", "says": [2]}, {"name": "**Garden**", "says": [4]}]\n```';
    expect(projectsReply(reply, items)).toEqual({
      projects: [
        { name: "Website redesign", items: [items[0]!.text] },
        { name: "Japan trip", items: [items[1]!.text] },
        { name: "Garden", items: [items[3]!.text] },
      ],
      left: 1,
    });
  });

  test("one project can hold several items, in their order", () => {
    const reply = '[{"name": "Launch", "says": [4, 1, 2]}]';
    expect(projectsReply(reply, items)?.projects[0]?.items).toEqual([
      items[0]!.text,
      items[1]!.text,
      items[3]!.text,
    ]);
  });

  test("an item goes to the first project that claims it", () => {
    const reply = '[{"name": "A", "says": [1, 2]}, {"name": "B", "says": [2]}]';
    expect(projectsReply(reply, items)?.projects.map((p) => p.name)).toEqual(["A"]);
  });

  test("names lose [[ ]], quotes and a final period; same names merge", () => {
    const reply =
      '[{"name": "[[Japan trip|Trip]]", "says": [2]}, {"name": "\\"japan trip.\\"", "says": [3]}]';
    expect(projectsReply(reply, items)?.projects).toEqual([
      { name: "Japan trip", items: [items[1]!.text, items[2]!.text] },
    ]);
  });

  test("drops projects without a name, an item, or with a sentence-long name", () => {
    const reply = JSON.stringify([
      { name: "", says: [1] },
      { name: "Nothing", says: [9] },
      { name: "one two three four five six seven eight nine", says: [1] },
    ]);
    expect(projectsReply(reply, items)).toEqual({ projects: [], left: 4 });
  });

  test("null when the reply isn't the JSON asked for", () => {
    expect(projectsReply("Sure! Here are your projects.", items)).toBeNull();
    expect(projectsReply("[not json]", items)).toBeNull();
  });
});
