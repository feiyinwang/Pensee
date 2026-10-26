import { describe, expect, it } from "vite-plus/test";
import { isAbsolutePath } from "../src/lib/paths";
import { keyLabel } from "../src/lib/platform";

describe("keyLabel", () => {
  it("leaves labels unchanged on macOS", () => {
    for (const label of ["⌘⇧Z", "⌘ K", "Press ⌘K to search", "⌘↩", "⌥⌘N", "Esc"]) {
      expect(keyLabel(label, "macos")).toBe(label);
    }
  });

  it("writes modifiers as words joined by + on Windows", () => {
    expect(keyLabel("⌘⇧Z", "windows")).toBe("Ctrl+Shift+Z");
    expect(keyLabel("⌘ K", "windows")).toBe("Ctrl+K");
    expect(keyLabel("⌘↩", "windows")).toBe("Ctrl+Enter");
    expect(keyLabel("⌥⌘N", "windows")).toBe("Alt+Ctrl+N");
    expect(keyLabel("⌥ ↵", "windows")).toBe("Alt+Enter");
  });

  it("rewrites a chord inside a sentence and keeps the rest", () => {
    expect(keyLabel("Press ⌘K to search", "windows")).toBe("Press Ctrl+K to search");
    expect(keyLabel("Undo (⌘Z)", "windows")).toBe("Undo (Ctrl+Z)");
  });

  it("maps a lone modifier keycap", () => {
    expect(keyLabel("⌘", "windows")).toBe("Ctrl");
    expect(keyLabel("⇧", "linux")).toBe("Shift");
    expect(keyLabel("S", "windows")).toBe("S");
  });
});

describe("isAbsolutePath", () => {
  it("reads POSIX and Windows absolute paths", () => {
    expect(isAbsolutePath("/Users/me/vault/a.md")).toBe(true);
    expect(isAbsolutePath("C:/Users/me/vault/a.md")).toBe(true);
    expect(isAbsolutePath("C:\\Users\\me\\a.md")).toBe(true);
    expect(isAbsolutePath("images/a.png")).toBe(false);
    expect(isAbsolutePath("../a.png")).toBe(false);
  });
});
