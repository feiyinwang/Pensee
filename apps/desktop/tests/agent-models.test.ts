import { describe, expect, it } from "vite-plus/test";
import { agentModel, parseModelCommand } from "../src/lib/agent-models";

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
});

describe("agentModel", () => {
  it("falls back to Haiku for unknown or missing ids", () => {
    expect(agentModel("opus").name).toBe("Opus");
    expect(agentModel(undefined).id).toBe("haiku");
    expect(agentModel("nope").id).toBe("haiku");
  });
});
