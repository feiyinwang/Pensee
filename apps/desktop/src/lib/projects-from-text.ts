import { organizeSentences } from "./second-pen";

// Add to Projects (SPECs/add-to-projects-spec.md): Claude reads a selection,
// sentence by sentence, and says which sentences make which project. The
// notes carry the writer's own sentences; Claude only names and groups them.

export interface Sentence {
  text: string;
}

export interface ProjectFromText {
  name: string;
  /** The writer's sentences behind it, in their order. */
  sentences: string[];
}

export interface ProjectsFromText {
  projects: ProjectFromText[];
  /** How many sentences are not part of any project. */
  left: number;
}

/** The selection's sentences, as Organize numbers them. */
export function selectionSentences(text: string): Sentence[] {
  return organizeSentences(text.split("\n").filter((line) => line.trim() !== "")).filter(
    (s) => s.text.trim() !== "",
  );
}

export function projectsPrompt(sentences: readonly Sentence[]): string {
  return [
    "The writer selected these sentences in a note and asked to add them to their Projects, numbered:",
    `<text>\n${sentences.map((s, k) => `<s n="${k + 1}">${s.text}</s>`).join("\n")}\n</text>`,
    "This task is the exception to writing one line: you sort the sentences into projects.",
    "A project is anything that takes more than two steps. A single to-do, or something done in one or two steps, is not a project: leave its sentence out.",
    "Each sentence that is its own project makes one project. Sentences that describe the same project make one project together: three sentences about one launch are one project, not three. Never put one sentence in two projects.",
    "Name each project. When the writer already named it, keep their name exactly as written: a [[link]], a **bold** lead, a heading, or a name before a colon or dash. Otherwise give it a short name, 1 to 5 words, close to what the sentences mean, in the language they are written in. No quotation marks, no ending period.",
    'Reply with JSON only: [{"name": "…", "says": [1, 2]}], in the order the sentences come. [] when none of it is a project.',
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

/** A reply's projects, held to its word: each sentence goes to the first
 *  project that claims it, a project with no name or no sentence is dropped,
 *  two with the same name are one. Null when the reply isn't the JSON asked
 *  for. */
export function projectsReply(
  reply: string,
  sentences: readonly Sentence[],
): ProjectsFromText | null {
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
      .filter((k) => k >= 0 && k < sentences.length && !claimed.has(k));
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
      sentences: p.says.sort((a, b) => a - b).map((k) => sentences[k]!.text),
    })),
    left: sentences.length - claimed.size,
  };
}
