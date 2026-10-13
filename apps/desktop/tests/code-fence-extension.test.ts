import { describe, expect, test } from "vite-plus/test";
import { __testCodeFenceExtension } from "../src/lib/prosemark-core/codeFenceExtension";

describe("codeFenceTheme", () => {
  test("fenced code lines follow the editor font size while keeping the code font", () => {
    const fencedCodeLine = __testCodeFenceExtension.codeFenceThemeSpec[".cm-fenced-code-line"];

    expect(fencedCodeLine.fontSize).toBe("var(--pensee-editor-font-size, 18px)");
    expect(fencedCodeLine.fontFamily).toContain("--pm-code-font");
  });
});
