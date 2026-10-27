import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { offerClaudeSignIn } from "@/stores/claude-sign-in-store";
import type { AgentModelId } from "../agent-models";
import { agentErrorText, parseAgentLine } from "../agent-stream";
import { agentInvokeArgs, agentTarget } from "../agent-target";
import { formatClock } from "./clock";

// The talk's Claude (SPECs/talk-notes-spec.md#while-you-talk-ask): the
// window's `talk` channel, a process of its own next to the pen's. One
// conversation per take, so it remembers the topics so far; each turn sends
// the lines Whisper has just heard and gets back, as JSON, which topic each
// belongs to and the Mermaid diagram of every topic that changed.

const CHANNEL = "talk";
/** A turn may redraw several diagrams; the larger models need the room. */
const TIMEOUT_MS = 90_000;

/** Your model from Settings → Agent, at least Balanced: the fastest keeps a
 *  mind map flat and drops "put X under Y", as Organize found (second-pen-agent.ts). */
function tier(): AgentModelId {
  const id = agentTarget().model.id;
  return id === "haiku" ? "sonnet" : id;
}

export const TALK_INSTRUCTIONS = `You listen to someone thinking out loud and keep their talk sorted into topics, live.
Each turn gives you the lines just heard, numbered, with their time. Reply with JSON only, no prose, no code fence:
{"lines":[{"n":4,"topic":"week","turn":"Okay, next"}],"topics":[{"key":"week","title":"Where my week goes","short":"My week","summary":"Writing takes most of the week, about twenty hours. QA and support eat most of the rest.","mermaid":"pie title Where my week goes\\n  \\"Writing\\" : 20"}]}

lines: one entry per line you were given.
- topic: the key of the topic the line is about, an existing one or a new short lowercase key. null for small talk ("Okay, a few things today.").
- turn: only when the speaker turns to a topic on purpose ("next", "moving on", "first", "one more on hiring"): the words that turned it, as said. Omit otherwise.
- aside: true when the line is said in passing about another topic while staying on the current one ("oh, and QA eats my evenings, but let me finish this"). Its topic is the other topic.
topics: every topic that is new or whose diagram changed this turn, with its full diagram.
- title: the topic in the speaker's words, sentence case. short: two or three words for a tab.
- summary: at most two sentences on what the speaker has concluded or plans about it so far, in their words. Not a list of what was said.
- mermaid: valid Mermaid text for the diagram that fits what was said. Choose by the shape of the talk, and look again every turn as it grows:
  flowchart for things done in order: "I'll do X, then Y", "first…, next…", "once that's done…", "after that…", a plan, a workflow, a process. One card per step, in the order they happen, chained A --> B --> C, always flowchart LR, each step in [brackets]; never a ; inside a label. A step's details go in its label ("Ad tests: Facebook, Google"), a condition between two steps on their link (B -->|verified| C); branch only when the speaker says "if…, otherwise…". A topic drawn as a mind map becomes a flowchart as soon as the speaker tells an order of steps;
  mindmap for ideas with no order: brainstorming, options, reasons, doubts around one question, and whenever no other type clearly fits;
  quadrantChart for options weighed on two scales (effort and value: x-axis Less effort --> More effort, y-axis Less value --> More value, each point written "Voice capture: [0.3, 0.8]", x and y from 0 to 1 in brackets);
  pie for shares of a whole; xychart for numbers across categories or time;
  journey for what a person goes through (score 1-5 per step); timeline for dates and plans over time (each "section" a workstream, drawn as its own row: "section Design" then "Mar : Sketches"); kanban for things to do;
  sankey for flows between stages; sequenceDiagram for who says what to whom.
  Use only what was said; short labels, a few words each, in the speaker's words; never invent numbers.
  Once a type the speaker asked for is set, keep it until they ask for another, then redraw that topic in it right away, with the same content: "as a mind map"; "as steps", "as a flow"; "as a matrix", "on two axes", "compare" (quadrantChart); "as a pie", "as shares"; "as a chart", "as bars", "over time" (xychart); "as a timeline"; "as a to-do board" (kanban); "as a journey".
Every time a topic changes, draw its whole diagram again from everything said about it so far, the way you'd draw it now that you know more: rename, regroup and reorder its nodes so it reads right, never just add the new lines at the end.
A node is something the speaker means (an idea, a step, an option, a reason), never their framing of it ("the idea is simple", "I want to visualize this") and never the topic's own title again.
The speaker directs the picture. When they say where something goes or how it relates ("X comes after Y", "X is a step of Y", "put X under Y", "move X to…", "rename X", "drop X", "draw this as a flow"), redraw the diagram exactly that way, even against how you drew it before: their latest word wins, and nothing they placed moves back. A line that only gives such an instruction changes the diagram; it is never itself a node.
Mind maps are MECE: the central topic has two to six branches, each a different kind of thing (say Sources, Evaluate, Test); every idea sits under the one branch it belongs to and nowhere else; siblings don't overlap, and together they cover everything said under their parent. When two branches overlap, or one holds more than six ideas, regroup. Group the way the speaker groups when they do. Flowcharts hold each step once, in its place in the order.
Buttons: the message may end with what the speaker asked for by clicking, instead of saying it. "Draw <key> as <type>" is the same as saying it; "New topic <key> from line <n>" means they started that topic there: line n and the lines after it are about it unless they clearly turn elsewhere (no New topic? offer needed), and you title it from what they say.
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
    })),
  };
}

/** The turn's message: what's known so far, then the new lines. */
export function talkPrompt(
  lines: HeardLine[],
  topics: { key: string; title: string; mermaid?: string }[],
  current: string | null,
  /** What the speaker asked for by button since the last turn. */
  buttons: string[] = [],
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
  const heard = lines.length
    ? lines.map((l) => `${l.n} [${formatClock(l.start)}] ${l.text}`).join("\n")
    : "(none)";
  const asked = buttons.length ? `\n\nButtons:\n${buttons.map((b) => `- ${b}`).join("\n")}` : "";
  return `Topics so far:\n${known}\n\nNew lines:\n${heard}${asked}`;
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
      const reason = agentErrorText(
        payload.stderr.trim().split("\n").pop() ?? "",
        agentTarget().provider.plan,
      );
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
    ...agentInvokeArgs(tier()),
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
      ...agentInvokeArgs(tier()),
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
