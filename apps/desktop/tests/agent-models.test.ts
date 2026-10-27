import { describe, expect, it } from "vite-plus/test";
import { agentModel, agentProvider, parseModelCommand } from "../src/lib/agent-models";

const ids = (draft: string) => parseModelCommand(draft)?.matches.map((model) => model.id);

describe("parseModelCommand", () => {
  it("ignores ordinary messages", () => {
    expect(parseModelCommand("Define junior")).toBeNull();
    expect(parseModelCommand("/etc/hosts is a file")).toBeNull();
    expect(parseModelCommand("/model\nsecond line")).toBeNull();
  });

  it("lists every model while the command is being typed", () => {
    expect(ids("/")).toEqual(["haiku", "sonnet", "opus"]);
    expect(ids("/mo")).toEqual(["haiku", "sonnet", "opus"]);
    expect(ids("/model ")).toEqual(["haiku", "sonnet", "opus"]);
  });

  it("filters by the argument, by id or name, any case", () => {
    expect(ids("/model o")).toEqual(["opus"]);
    expect(ids("/Model SON")).toEqual(["sonnet"]);
    expect(ids("/model gpt")).toEqual([]);
  });

  it("matches Codex's models by their own names", () => {
    const codex = (draft: string) =>
      parseModelCommand(draft, "codex")?.matches.map((model) => model.name);
    expect(codex("/model a")).toEqual(["Astra"]);
    expect(codex("/model so")).toEqual(["Sol"]);
    // A Codex tier's id is Claude's name; it doesn't match.
    expect(codex("/model opus")).toEqual([]);
  });
});

describe("agentModel", () => {
  it("falls back to Haiku for unknown or missing ids", () => {
    expect(agentModel("opus").name).toBe("Opus");
    expect(agentModel(undefined).id).toBe("haiku");
    expect(agentModel("nope").id).toBe("haiku");
  });

  it("maps the same tier to each CLI's model", () => {
    expect(agentModel("opus", "claude").cli).toBe("opus");
    expect(agentModel("opus", "codex")).toMatchObject({ name: "Astra", cli: "gpt-6-astra" });
    expect(agentModel(undefined, "codex").name).toBe("Luna");
  });
});

describe("agentProvider", () => {
  it("falls back to Claude Code", () => {
    expect(agentProvider("codex").plan).toBe("ChatGPT");
    expect(agentProvider(undefined).id).toBe("claude");
    expect(agentProvider("gemini").id).toBe("claude");
  });
});
