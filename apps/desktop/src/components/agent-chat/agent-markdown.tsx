import type { ReactNode } from "react";

/**
 * The small slice of markdown the agent's short replies use: paragraphs,
 * bullet and numbered lists, fenced code, inline `code` and **bold**.
 * Anything else shows as its plain text, which is still readable.
 */
export function AgentMarkdown({ text }: { text: string }) {
  return <>{renderBlocks(text)}</>;
}

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; lines: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const line of text.split("\n")) {
    if (current?.kind === "code") {
      if (line.trimStart().startsWith("```")) flush();
      else current.lines.push(line);
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      flush();
      current = { kind: "code", lines: [] };
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet?.[1] ?? numbered?.[1];
    if (item !== undefined) {
      const ordered = numbered !== null;
      if (current?.kind !== "list" || current.ordered !== ordered) {
        flush();
        current = { kind: "list", ordered, items: [] };
      }
      current.items.push(item);
      continue;
    }
    if (current?.kind !== "paragraph") {
      flush();
      current = { kind: "paragraph", lines: [] };
    }
    current.lines.push(line.replace(/^#+\s+/, ""));
  }
  flush();
  return blocks;
}

function renderBlocks(text: string): ReactNode[] {
  return parseBlocks(text).map((block, index) => {
    switch (block.kind) {
      case "paragraph":
        return <p key={index}>{renderInline(block.lines.join("\n"))}</p>;
      case "code":
        return (
          <pre
            key={index}
            className="overflow-x-auto rounded-lg bg-[var(--code-bg)] px-3 py-2 font-[family-name:var(--mono-font)] text-[12px]"
          >
            {block.lines.join("\n")}
          </pre>
        );
      case "list": {
        const List = block.ordered ? "ol" : "ul";
        return (
          <List
            key={index}
            className={`flex flex-col gap-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}
          >
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </List>
        );
      }
    }
  });
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return (
        <code
          key={index}
          className="rounded bg-[var(--code-bg)] px-1 py-px font-[family-name:var(--mono-font)] text-[0.9em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}
