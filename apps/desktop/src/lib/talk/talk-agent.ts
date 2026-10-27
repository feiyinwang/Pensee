import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { offerClaudeSignIn } from "@/stores/claude-sign-in-store";
import { useSettingsStore } from "@/stores/settings-store";
import { agentModel } from "../agent-models";
import { agentErrorText, parseAgentLine } from "../agent-stream";
import { formatClock } from "./clock";

// The talk's Claude (SPECs/talk-notes-spec.md#while-you-talk-ask): the
// window's `talk` channel, a process of its own next to the pen's. One
// conversation per take, so it remembers the topics so far; each turn sends
// the lines Whisper has just heard and gets back, as JSON, which topic each
// belongs to and the Mermaid diagram of every topic that changed.

const CHANNEL = "talk";
/** A turn may redraw several diagrams; the larger models need the room. */
const TIMEOUT_MS = 90_000;

/** Your model from Settings → Agent, at least Sonnet: Haiku keeps a mind map
 *  flat and drops "put X under Y", as Organize found (second-pen-agent.ts). */
function model(): string {
  const id = agentModel(useSettingsStore.getState().getSetting("agent.model")).id;
  return id === "haiku" ? "sonnet" : id;
}

export const TALK_INSTRUCTIONS = `You listen to someone thinking out loud and keep their talk sorted into topics, live.
Each turn gives you the lines just heard, numbered, with their time. Reply with JSON only, no prose, no code fence:
{"lines":[{"n":4,"topic":"week","turn":"Okay, next"}],"topics":[{"key":"week","title":"Where my week goes","short":"My week","summary":"Writing takes most of the week, about twenty hours. QA and support eat most of the rest.","mermaid":"pie title Where my week goes\\n  \\"Writing\\" : 20","sources":{"Writing":[5]}}]}

lines: one entry per line you were given.
- topic: the key of the topic the line is about, an existing one or a new short lowercase key. null for small talk ("Okay, a few things today.").
- turn: only when the speaker turns to a topic on purpose ("next", "moving on", "first", "one more on hiring"): the words that turned it, as said. Omit otherwise.
- aside: true when the line is said in passing about another topic while staying on the current one ("oh, and QA eats my evenings, but let me finish this"). Its topic is the other topic.
topics: every topic that is new or whose diagram changed this turn, with its full diagram.
- title: the topic in the speaker's words, sentence case. short: two or three words for a tab.
- summary: at most two sentences on what the speaker has concluded or plans about it so far, in their words. Not a list of what was said.
- sources: for every node, slice or point in the diagram, its label exactly as written in the mermaid, mapped to the numbers of the lines it came from (the lines that said it). Every node gets its lines; the central topic too.
- mermaid: valid Mermaid text for the diagram that fits what was said. Choose:
  quadrantChart for options weighed on two scales (effort and value: x-axis Less effort --> More effort, y-axis Less value --> More value, each point written "Voice capture: [0.3, 0.8]", x and y from 0 to 1 in brackets);
  pie for shares of a whole; xychart for numbers across categories or time; mindmap for reasons, doubts and plans around one question;
  flowchart for steps or causes; journey for what a person goes through (score 1-5 per step); timeline for dates; kanban for things to do;
  sankey for flows between stages; sequenceDiagram for who says what to whom.
  Use only what was said; short labels in the speaker's words; never invent numbers. Keep a topic's diagram type once chosen.
The speaker directs the picture. When they say where something goes or how it relates ("X comes after Y", "X is a step of Y", "put X under Y", "move X to…", "rename X", "drop X", "draw this as a flow"), redraw the diagram exactly that way, even against how you drew it before: their latest word wins, and nothing they placed moves back. A line that only gives such an instruction changes the diagram; it is never itself a node.
Mind maps and flowcharts are MECE: every node says one thing, siblings don't overlap, together they cover what was said under their parent, nothing appears twice, and something said to belong under a node sits only there. Group the way the speaker groups.
Write in the language the speaker uses.`;

/** What the agent says about one line. */
export interface LineVerdict {
  n: number;
  topic: string | null;
  turn?: string;
  aside?: boolean;
}

export interface TopicUpdate {
  key: string;
  title: string;
  short: string;
  mermaid: string;
  summary?: string;
  sources?: Record<string, number[]>;
}

export interface TalkReply {
  lines: LineVerdict[];
  topics: TopicUpdate[];
}

/** A heard line, as the agent is told it. */
export interface HeardLine {
  n: number;
  start: number;
  text: string;
}

/** A topic's node → lines map, keeping only labels with line numbers. */
function lineSources(raw: unknown): Record<string, number[]> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, number[]> = {};
  for (const [label, lines] of Object.entries(raw as Record<string, unknown>)) {
    const ns = Array.isArray(lines) ? lines.filter((n): n is number => Number.isInteger(n)) : [];
    if (ns.length) out[label] = ns;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The JSON in a reply, forgiving a code fence or a sentence around it. */
export function parseTalkReply(text: string): TalkReply {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The reply had no JSON.");
  const raw = JSON.parse(text.slice(start, end + 1)) as Partial<TalkReply>;
  const lines = (raw.lines ?? []).filter((l): l is LineVerdict => typeof l?.n === "number");
  const topics = (raw.topics ?? []).filter(
    (t): t is TopicUpdate =>
      typeof t?.key === "string" && typeof t.mermaid === "string" && typeof t.title === "string",
  );
  return {
    lines: lines.map((l) => ({
      ...l,
      topic: typeof l.topic === "string" && l.topic ? l.topic : null,
    })),
    topics: topics.map((t) => ({
      ...t,
      short: typeof t.short === "string" && t.short ? t.short : t.title,
      summary: typeof t.summary === "string" && t.summary.trim() ? t.summary.trim() : undefined,
      sources: lineSources(t.sources),
    })),
  };
}

/** The turn's message: what's known so far, then the new lines. */
export function talkPrompt(
  lines: HeardLine[],
  topics: { key: string; title: string; mermaid?: string }[],
  current: string | null,
): string {
  // The diagrams go along too: a Continue starts a new conversation, and an
  // updated diagram must keep what earlier takes put in it.
  const known = topics.length
    ? topics
        .map(
          (t) =>
            `- ${t.key}: ${t.title}${t.key === current ? " (current)" : ""}${t.mermaid ? `\n${t.mermaid.replace(/^/gm, "    ")}` : ""}`,
        )
        .join("\n")
    : "(none yet)";
  const heard = lines.map((l) => `${l.n} [${formatClock(l.start)}] ${l.text}`).join("\n");
  return `Topics so far:\n${known}\n\nNew lines:\n${heard}`;
}

interface Waiting {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  text: string;
}
const waiting = new Map<string, Waiting>();
let listening = false;

function ensureListeners(): void {
  if (listening) return;
  listening = true;
  void listen<{ requestId: string; line: string }>("agent:line", ({ payload }) => {
    const request = waiting.get(payload.requestId);
    if (!request) return;
    for (const event of parseAgentLine(payload.line)) {
      if (event.kind === "text") request.text += event.text;
      if (event.kind !== "result") continue;
      waiting.delete(payload.requestId);
      if (event.isError) {
        offerClaudeSignIn(event.text);
        request.reject(new Error(event.text || "Claude stopped with an error."));
      } else request.resolve(event.text || request.text);
    }
  });
  void listen<{ requestId: string; code: number | null; stderr: string }>(
    "agent:exit",
    ({ payload }) => {
      const request = waiting.get(payload.requestId);
      if (!request) return;
      waiting.delete(payload.requestId);
      const reason = agentErrorText(payload.stderr.trim().split("\n").pop() ?? "");
      offerClaudeSignIn(reason);
      request.reject(new Error(reason || "Claude stopped before it sorted the talk."));
    },
  );
}

/** Starts the take's conversation ahead, so the first lines skip Claude's startup. */
export function warmTalk(): void {
  ensureListeners();
  invoke("agent_warm", {
    sessionId: null,
    instructions: TALK_INSTRUCTIONS,
    model: model(),
    channel: CHANNEL,
  }).catch((error: unknown) => console.error("[talk] Couldn't start Claude ahead of time:", error));
}

/** One turn: the new lines in, the verdicts and diagrams out. */
export function askTalk(prompt: string): Promise<TalkReply> {
  ensureListeners();
  const requestId = crypto.randomUUID();
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!waiting.delete(requestId)) return;
      void invoke("agent_cancel", { requestId, channel: CHANNEL });
      reject(new Error("Claude took too long to sort the talk."));
    }, TIMEOUT_MS);
    waiting.set(requestId, {
      resolve: (text) => (clearTimeout(timer), resolve(text)),
      reject: (error) => (clearTimeout(timer), reject(error)),
      text: "",
    });
    invoke("agent_send", {
      requestId,
      prompt,
      sessionId: null,
      instructions: TALK_INSTRUCTIONS,
      model: model(),
      channel: CHANNEL,
    }).catch((error: unknown) => {
      const request = waiting.get(requestId);
      if (!request) return;
      waiting.delete(requestId);
      request.reject(error instanceof Error ? error : new Error(String(error)));
    });
  }).then(parseTalkReply);
}

/** Ends the take's conversation: the next talk starts from nothing. */
export function endTalk(): void {
  invoke("agent_reset", { channel: CHANNEL }).catch((error: unknown) =>
    console.error("[talk] Couldn't reset Claude:", error),
  );
}
