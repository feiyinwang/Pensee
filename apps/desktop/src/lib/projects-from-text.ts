import { itemText, sentencesOf } from "./second-pen";

// Add to Projects (SPECs/add-to-projects-spec.md): Claude reads a selection,
// item by item, and says which items make which project. The notes carry the
// writer's own words; Claude only names and groups them.

export interface Item {
  text: string;
}

export interface ProjectFromText {
  name: string;
  /** The writer's items behind it, in their order. */
  items: string[];
}

export interface ProjectsFromText {
  projects: ProjectFromText[];
  /** How many items are not part of any project. */
  left: number;
}

const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/;
const HEADING_RE = /^#{1,6}\s+/;

/** The selection's items: a bullet or a heading is one item, whole, since the
 *  writer split those on purpose (2026-10-18: a bullet cut into its
 *  sentences read as fragments, and three bullets became one project); a
 *  paragraph is one item per sentence. */
export function selectionItems(text: string): Item[] {
  return text.split("\n").flatMap((line) => {
    if (LIST_ITEM_RE.test(line) || HEADING_RE.test(line)) {
      const body = itemText(line).replace(HEADING_RE, "").trim();
      return body ? [{ text: body }] : [];
    }
    return sentencesOf(line.trim()).map((sentence) => ({ text: sentence }));
  });
}

/** How many of the writer's project names the prompt carries, so a long
 *  vault doesn't make it long. */
const EXISTING_MAX = 300;

/** The request: `items`, and `existing`, the names of the writer's projects,
 *  so one already there is named as it is instead of made again. */
export function projectsPrompt(items: readonly Item[], existing: readonly string[] = []): string {
  const known = existing.slice(0, EXISTING_MAX);
  return [
    "The writer selected these lines in a note and asked to add them to their Projects. Each item is one bullet they wrote, or one sentence of a paragraph, numbered:",
    `<text>\n${items.map((item, k) => `<item n="${k + 1}">${item.text}</item>`).join("\n")}\n</text>`,
    "This task is the exception to writing one line: you sort the items into projects.",
    'A project is anything that takes more than two steps to get done. Judge by the work it takes in practice, not by how short the line is: "Make a Discord channel to encourage people to post" is a project (set up the server and its channels, write the rules, invite people, keep it going); "Call Sam" or "Reply to Anna" is not. Leave out an item that is not a project.',
    'Each item is its own project: the writer split them on purpose. Items that serve the same goal are still separate projects when each is its own piece of work: a one page website, a Discord community and an email address for customer questions are three projects, even when all three are for one launch. Put items in one project only when one is a step, a detail or a later stage of another, as "Book flights" and "Book a hotel" under "Japan trip", or testing a flow after building it. Never put one item in two projects.',
    "Name each project. When the writer already named it, keep their name exactly as written: a [[link]], a **bold** lead, a heading, or a name before a colon or dash. Otherwise give it a short name, 1 to 5 words, close to what the item means, in the language it is written in. No quotation marks, no ending period.",
    ...(known.length > 0
      ? [
          'The writer\'s projects so far. Before naming a project, look for it here: when one of these is about the same piece of work, even worded differently ("Website launch" and "Launch the website" are the same), use its name exactly as listed, so it isn\'t made twice:',
          `<projects>\n${known.join("\n")}\n</projects>`,
        ]
      : []),
    'Reply with JSON only: [{"name": "…", "says": [1, 2]}], in the order the items come. [] when none of it is a project.',
  ].join("\n");
}

/** Past this a name is a sentence, not a name. */
const NAME_MAX_WORDS = 8;

function nameOf(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const name = raw
    .replace(/\[\[([^\]|]*)(?:\|[^\]]*)?\]\]/g, "$1")
    .replace(/[*_`"“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。]$/u, "");
  return name && name.split(" ").length <= NAME_MAX_WORDS ? name : "";
}

/** A reply's projects, held to its word: each item goes to the first
 *  project that claims it, a project with no name or no item is dropped,
 *  two with the same name are one. Null when the reply isn't the JSON asked
 *  for. */
export function projectsReply(reply: string, items: readonly Item[]): ProjectsFromText | null {
  const json = /\[[\s\S]*\]/.exec(reply)?.[0];
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const claimed = new Set<number>();
  const byName = new Map<string, { name: string; says: number[] }>();
  for (const item of data) {
    const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const name = nameOf(entry.name);
    if (!name) continue;
    const says = (Array.isArray(entry.says) ? entry.says : [])
      .map((n) => (typeof n === "number" && Number.isInteger(n) ? n - 1 : -1))
      .filter((k) => k >= 0 && k < items.length && !claimed.has(k));
    if (says.length === 0) continue;
    for (const k of says) claimed.add(k);
    const key = name.toLowerCase();
    const project = byName.get(key) ?? { name, says: [] };
    project.says.push(...says);
    byName.set(key, project);
  }
  return {
    projects: [...byName.values()].map((p) => ({
      name: p.name,
      items: p.says.sort((a, b) => a - b).map((k) => items[k]!.text),
    })),
    left: items.length - claimed.size,
  };
}
