/** The CLIs the pen, talks and the Agent chat can run on (`agent.provider`).
 *  `plan` is the subscription it signs in with. Must match the
 *  `agent.provider` options in settings.schema.json. */
export const AGENT_PROVIDERS = [
  { id: "claude", name: "Claude Code", plan: "Claude" },
  { id: "codex", name: "Codex", plan: "ChatGPT" },
] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];
export type AgentProviderId = AgentProvider["id"];

export function agentProvider(id: string | undefined): AgentProvider {
  return AGENT_PROVIDERS.find((provider) => provider.id === id) ?? AGENT_PROVIDERS[0];
}

/** The model tiers, in the order the `/model` menu lists them. A tier's id is
 *  the `agent.model` setting (Claude's names, kept so existing settings still
 *  read), so switching CLI keeps the writer's speed choice. `cli` is what the
 *  CLI is started with: Claude Code's `--model` aliases follow the newest
 *  release of each tier without an app update; Codex has no aliases, so its
 *  ids change when OpenAI renames a family. Must match the `agent.model`
 *  options in settings.schema.json. */
const MODELS = {
  claude: [
    { id: "haiku", name: "Haiku", blurb: "Fastest", cli: "haiku" },
    { id: "sonnet", name: "Sonnet", blurb: "Balanced", cli: "sonnet" },
    { id: "opus", name: "Opus", blurb: "Smartest, slowest", cli: "opus" },
  ],
  codex: [
    { id: "haiku", name: "Luna", blurb: "Fastest", cli: "gpt-6-luna" },
    { id: "sonnet", name: "Sol", blurb: "Balanced", cli: "gpt-6.1-sol" },
    { id: "opus", name: "Astra", blurb: "Smartest, slowest", cli: "gpt-6-astra" },
  ],
} as const satisfies Record<AgentProviderId, readonly AgentModelShape[]>;

interface AgentModelShape {
  id: "haiku" | "sonnet" | "opus";
  name: string;
  blurb: string;
  cli: string;
}

export type AgentModel = (typeof MODELS)[AgentProviderId][number];
export type AgentModelId = AgentModel["id"];

export const DEFAULT_AGENT_MODEL: AgentModelId = "haiku";

export function agentModels(provider: AgentProviderId = "claude"): readonly AgentModel[] {
  return MODELS[provider];
}

export function agentModel(
  id: string | undefined,
  provider: AgentProviderId = "claude",
): AgentModel {
  const models = agentModels(provider);
  return models.find((model) => model.id === id) ?? models[0]!;
}

const COMMAND = "/model";

/** What a composer draft means for the `/model` menu:
 *  - `null`: an ordinary message.
 *  - `{ matches }`: the draft is a `/model` command (or a prefix of one);
 *    `matches` are the models its argument still fits, possibly none. */
export function parseModelCommand(
  draft: string,
  provider: AgentProviderId = "claude",
): { matches: AgentModel[] } | null {
  const models = agentModels(provider);
  const text = draft.trimStart().toLowerCase();
  if (!text.startsWith("/") || text.includes("\n")) return null;
  const [command = "", ...rest] = text.split(/\s+/);
  if (rest.length === 0) {
    // Still typing the command itself: "/", "/mo", "/model".
    return COMMAND.startsWith(command) ? { matches: [...models] } : null;
  }
  if (command !== COMMAND) return null;
  const query = rest.join(" ").trim();
  return {
    // By the name the menu shows: a Codex tier's id is Claude's name.
    matches: models.filter((model) => model.name.toLowerCase().startsWith(query)),
  };
}
