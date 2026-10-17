import { describe, expect, test } from "vite-plus/test";
import { projectsPrompt, projectsReply, selectionSentences } from "../src/lib/projects-from-text";

const TEXT = [
  "- Website redesign: move to the new CMS, redo the nav, launch by June.",
  "- Plan the Japan trip with flights, hotels and a rail pass. Call Sam.",
  "",
  "**Garden**: dig the beds, plant bulbs, set up watering.",
].join("\n");

describe("selectionSentences", () => {
  test("numbers each sentence, without list markers or blank lines", () => {
    expect(selectionSentences(TEXT).map((s) => s.text)).toEqual([
      "Website redesign: move to the new CMS, redo the nav, launch by June.",
      "Plan the Japan trip with flights, hotels and a rail pass.",
      "Call Sam.",
      "**Garden**: dig the beds, plant bulbs, set up watering.",
    ]);
  });
});

describe("projectsPrompt", () => {
  test("numbers the sentences and states the rules", () => {
    const prompt = projectsPrompt(selectionSentences(TEXT));
    expect(prompt).toContain('<s n="3">Call Sam.</s>');
    expect(prompt).toContain("more than two steps");
    expect(prompt).toContain("keep their name exactly as written");
  });
});

describe("projectsReply", () => {
  const sentences = selectionSentences(TEXT);

  test("takes each project's sentences and counts the ones left out", () => {
    const reply =
      '```json\n[{"name": "Website redesign", "says": [1]}, {"name": "Japan trip", "says": [2]}, {"name": "**Garden**", "says": [4]}]\n```';
    expect(projectsReply(reply, sentences)).toEqual({
      projects: [
        {
          name: "Website redesign",
          sentences: ["Website redesign: move to the new CMS, redo the nav, launch by June."],
        },
        {
          name: "Japan trip",
          sentences: ["Plan the Japan trip with flights, hotels and a rail pass."],
        },
        { name: "Garden", sentences: ["**Garden**: dig the beds, plant bulbs, set up watering."] },
      ],
      left: 1,
    });
  });

  test("one project can hold several sentences, in their order", () => {
    const reply = '[{"name": "Launch", "says": [4, 1, 2]}]';
    expect(projectsReply(reply, sentences)?.projects[0]?.sentences).toHaveLength(3);
    expect(projectsReply(reply, sentences)?.projects[0]?.sentences[0]).toMatch(/^Website/);
  });

  test("a sentence goes to the first project that claims it", () => {
    const reply = '[{"name": "A", "says": [1, 2]}, {"name": "B", "says": [2]}]';
    expect(projectsReply(reply, sentences)?.projects.map((p) => p.name)).toEqual(["A"]);
  });

  test("names lose [[ ]], quotes and a final period; same names merge", () => {
    const reply =
      '[{"name": "[[Japan trip|Trip]]", "says": [2]}, {"name": "\\"japan trip.\\"", "says": [3]}]';
    expect(projectsReply(reply, sentences)?.projects).toEqual([
      { name: "Japan trip", sentences: [sentences[1]!.text, sentences[2]!.text] },
    ]);
  });

  test("drops projects without a name, a sentence, or with a sentence-long name", () => {
    const reply = JSON.stringify([
      { name: "", says: [1] },
      { name: "Nothing", says: [9] },
      { name: "one two three four five six seven eight nine", says: [1] },
    ]);
    expect(projectsReply(reply, sentences)).toEqual({ projects: [], left: 4 });
  });

  test("null when the reply isn't the JSON asked for", () => {
    expect(projectsReply("Sure! Here are your projects.", sentences)).toBeNull();
    expect(projectsReply("[not json]", sentences)).toBeNull();
  });
});
