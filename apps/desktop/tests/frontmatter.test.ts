import { describe, expect, test } from "vite-plus/test";
import {
  parseDocument,
  parseFrontmatter,
  serializeDocument,
  serializeFile,
} from "../src/lib/frontmatter";

describe("parseFrontmatter", () => {
  test("extracts frontmatter and body", () => {
    const raw = "---\ntitle: Hello\ndate: 2024-01-01\n---\n# Content";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toBe("title: Hello\ndate: 2024-01-01");
    expect(result.body).toBe("# Content");
  });

  test("returns null frontmatter for files without it", () => {
    const raw = "# Just a heading\n\nSome text";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(raw);
  });

  test("preserves blank line between frontmatter and body", () => {
    const raw = "---\ntitle: Test\n---\n\n# Content";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toBe("title: Test");
    expect(result.body).toBe("\n# Content");
  });

  test("handles empty frontmatter", () => {
    const raw = "---\n\n---\nBody";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toBe("");
    expect(result.body).toBe("Body");
  });

  test("does not treat mid-document --- as frontmatter", () => {
    const raw = "Some text\n---\ntitle: Nope\n---\nMore text";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(raw);
  });

  test("handles empty frontmatter with no blank line between delimiters", () => {
    const raw = "---\n---\nBody";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toBe("");
    expect(result.body).toBe("Body");
  });

  test("handles empty frontmatter at end of file (no trailing newline)", () => {
    const raw = "---\n---";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toBe("");
    expect(result.body).toBe("");
  });

  test("handles empty file", () => {
    const result = parseFrontmatter("");
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe("");
  });
});

describe("serializeFile", () => {
  test("wraps frontmatter in --- delimiters", () => {
    const result = serializeFile("title: Hello", "# Content");
    expect(result).toBe("---\ntitle: Hello\n---\n# Content");
  });

  test("returns body only when frontmatter is null", () => {
    const result = serializeFile(null, "# Content");
    expect(result).toBe("# Content");
  });

  test("serializes empty frontmatter block", () => {
    const result = serializeFile("", "Body");
    expect(result).toBe("---\n\n---\nBody");
  });

  test("round-trips correctly", () => {
    const original = "---\ntitle: Test\ntags: [a, b]\n---\n\n# Hello\n\nWorld";
    const { frontmatter, body } = parseFrontmatter(original);
    const reconstructed = serializeFile(frontmatter, body);
    expect(reconstructed).toBe(original);
  });

  test("round-trips empty frontmatter correctly", () => {
    const original = "---\n\n---\nBody";
    const { frontmatter, body } = parseFrontmatter(original);
    expect(frontmatter).toBe("");
    const reconstructed = serializeFile(frontmatter, body);
    expect(reconstructed).toBe(original);
  });
});

describe("parseDocument", () => {
  test("frontmatter title wins but body is preserved verbatim", () => {
    const result = parseDocument("---\ntitle: Hello\ntags: [a]\n---\n\n# Hello #\n\nBody");

    expect(result.frontmatter).toBe("title: Hello\ntags: [a]");
    expect(result.title).toBe("Hello");
    expect(result.titleSource).toBe("frontmatter");
    expect(result.body).toBe("\n# Hello #\n\nBody");
  });

  test("a leading H1 is body text, never the title", () => {
    const result = parseDocument("\n# Project Plan\n\nBody text.");

    expect(result.title).toBe("");
    expect(result.titleSource).toBe("none");
    expect(result.body).toBe("\n# Project Plan\n\nBody text.");
  });

  test("resolves to an empty title when no explicit title exists", () => {
    const result = parseDocument("Body text.");

    expect(result.title).toBe("");
    expect(result.titleSource).toBe("none");
    expect(result.body).toBe("Body text.");
  });
});

describe("parseDocument daily notes", () => {
  test("keeps an empty title for a daily note with a leading heading", () => {
    const result = parseDocument("# Standup notes\n\nSome text", "/vault/2026-09-02.md");
    expect(result.title).toBe("");
    expect(result.titleSource).toBe("none");
  });

  test("ignores a frontmatter title on a daily note", () => {
    const result = parseDocument("---\ntitle: Renamed\n---\n# Body", "/vault/2026-09-02.md");
    expect(result.title).toBe("");
    expect(result.titleSource).toBe("none");
  });

  test("still reads a frontmatter title for a dated name that is not a daily note", () => {
    const result = parseDocument("---\ntitle: Retro\n---\n", "/vault/2026-09-02 retro.md");
    expect(result.title).toBe("Retro");
    expect(result.titleSource).toBe("frontmatter");
  });
});

describe("serializeDocument", () => {
  test("writes the body verbatim when there is no frontmatter", () => {
    const result = serializeDocument(null, "# Project Plan\n\nBody text.");
    expect(result).toBe("# Project Plan\n\nBody text.");
  });

  test("prepends frontmatter when present", () => {
    const result = serializeDocument("title: Hello", "Body text.");
    expect(result).toBe("---\ntitle: Hello\n---\nBody text.");
  });
});
