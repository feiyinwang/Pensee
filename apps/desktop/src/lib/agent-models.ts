/** The models the Agent chat can run, in the order the `/model` menu lists
 *  them. Ids are Claude Code's `--model` aliases, so they follow the newest
 *  release of each tier without an app update. Must match the `agent.model`
 *  options in settings.schema.json. */
export const AGENT_MODELS = [
  { id: "haiku", name: "Haiku", blurb: "Fastest" },
  { id: "sonnet", name: "Sonnet", blurb: "Balanced" },
  { id: "opus", name: "Opus", blurb: "Smartest, slowest" },
] as const;

export type AgentModel = (typeof AGENT_MODELS)[number];
export type AgentModelId = AgentModel["id"];

export const DEFAULT_AGENT_MODEL: AgentModelId = "haiku";

export function agentModel(id: string | undefined): AgentModel {
  return AGENT_MODELS.find((model) => model.id === id) ?? AGENT_MODELS[0];
}

const COMMAND = "/model";

/** What a composer draft means for the `/model` menu:
 *  - `null`: an ordinary message.
 *  - `{ matches }`: the draft is a `/model` command (or a prefix of one);
 *    `matches` are the models its argument still fits, possibly none. */
export function parseModelCommand(draft: string): { matches: AgentModel[] } | null {
  const text = draft.trimStart().toLowerCase();
  if (!text.startsWith("/") || text.includes("\n")) return null;
  const [command = "", ...rest] = text.split(/\s+/);
  if (rest.length === 0) {
    // Still typing the command itself: "/", "/mo", "/model".
    return COMMAND.startsWith(command) ? { matches: [...AGENT_MODELS] } : null;
  }
  if (command !== COMMAND) return null;
  const query = rest.join(" ").trim();
  return {
    matches: AGENT_MODELS.filter(
      (model) => model.id.startsWith(query) || model.name.toLowerCase().startsWith(query),
    ),
  };
}
