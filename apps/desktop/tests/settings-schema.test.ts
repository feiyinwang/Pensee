import { describe, expect, test } from "vite-plus/test";
import { tokenValue } from "../src/lib/design-tokens";
import {
  getPrimaryDefs,
  SETTINGS_SCHEMA,
  suffixOf,
  type ThemeMode,
} from "../src/lib/settings-schema";

// The one theme: Ink, recorded in shared/themes/ink/ as one JSON per mode
// holding exactly the editable primaries (SPECs/ink-only-colour-spec.md).
const themeFiles = import.meta.glob<Record<string, unknown>>("../shared/themes/*/*.json", {
  eager: true,
  import: "default",
});

describe("typography settings", () => {
  test("keep their persisted keys and CSS bindings under the Typography category", () => {
    const fonts = SETTINGS_SCHEMA.filter((def) => def.key.startsWith("fonts.")).map((def) => ({
      key: def.key,
      label: def.label,
      category: def.category,
      type: def.type,
      cssVar: def.cssVar,
    }));

    expect(fonts).toEqual([
      {
        key: "fonts.ui",
        label: "UI font",
        category: "Typography",
        type: "font",
        cssVar: "--ui-font",
      },
      {
        key: "fonts.editor",
        label: "Editor font",
        category: "Typography",
        type: "font",
        cssVar: "--editor-font",
      },
      {
        key: "fonts.mono",
        label: "Code font",
        category: "Typography",
        type: "font",
        cssVar: "--mono-font",
      },
    ]);
  });

  test("default to SF Pro for prose and SF Mono for code", () => {
    const defaults = Object.fromEntries(
      SETTINGS_SCHEMA.filter((def) => def.key.startsWith("fonts.")).map((def) => [
        def.key,
        String(def.default),
      ]),
    );

    const proseFallback =
      '-apple-system-body, ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"';
    const monoFallback =
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

    expect(defaults["fonts.ui"]).toBe(`"SF Pro", ${proseFallback}`);
    expect(defaults["fonts.editor"]).toBe(`"SF Pro", ${proseFallback}`);
    expect(defaults["fonts.mono"]).toBe(`"SF Mono", ${monoFallback}`);
  });
});

describe("default terminal setting", () => {
  test("exposes the cross-platform terminal preference contract", () => {
    const definition = SETTINGS_SCHEMA.find((def) => def.key === "workspace.default-terminal");
    expect(definition).toMatchObject({
      label: "Default Terminal",
      description:
        "Terminal application name on macOS, or executable name/full path on Windows and Linux. Leave blank for Pensée's platform default; arguments are not supported.",
      category: "Workspace",
      type: "string",
      placeholder: "Platform default",
      normalize: "trim",
      scope: "global",
      default: "",
    });
  });
});

describe("daily note folder setting", () => {
  test("exposes the workspace-scoped daily note folder contract", () => {
    const definition = SETTINGS_SCHEMA.find((def) => def.key === "workspace.daily-note-folder");
    expect(definition).toMatchObject({
      label: "Daily Note Folder",
      description:
        "Folder inside the workspace where dated daily notes are created. Leave blank to create them at the workspace root.",
      category: "Workspace",
      type: "string",
      placeholder: "Workspace root",
      normalize: "trim",
      default: "",
    });
    // Daily notes belong to a vault, not to the app — no global scope override.
    expect(definition).not.toHaveProperty("scope");
  });
});

describe("Ink, the only theme", () => {
  test("is the only theme folder, one file per mode", () => {
    expect(Object.keys(themeFiles).sort()).toEqual([
      "../shared/themes/ink/dark.json",
      "../shared/themes/ink/light.json",
    ]);
  });

  test("keeps the accent out of the theme primaries: one setting, a palette hue", () => {
    for (const mode of ["light", "dark"] as const) {
      expect(getPrimaryDefs(mode).map((def) => suffixOf(mode, def.key))).toEqual([
        "background",
        "foreground",
        "translucent",
        "contrast",
      ]);
    }
    const accents = SETTINGS_SCHEMA.filter((def) => def.key.endsWith(".accent"));
    expect(accents.map((def) => def.key)).toEqual(["appearance.accent"]);
    const [accent] = accents;
    expect(accent.default).toBe("blue");
    expect(accent.cssFormat).toBe("hue");
    // Every option names a hue token, so the setting can never point at nothing.
    for (const option of accent.options ?? []) {
      expect(tokenValue(`--hue-${option}`, "light")).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("its files equal the schema's theme defaults, so a fresh install opens on them", () => {
    for (const [path, values] of Object.entries(themeFiles)) {
      const mode: ThemeMode = path.endsWith("/dark.json") ? "dark" : "light";
      const defaults = Object.fromEntries(
        getPrimaryDefs(mode).map((def) => [suffixOf(mode, def.key), def.default]),
      );
      expect(values, path).toEqual(defaults);
    }
    // The warm neutrals (SPECs/harvey-neutral-colour-spec.md).
    const nearBlack = "#0F0E0D";
    const nearWhite = "#FAFAF9";
    const defaultOf = (key: string) => SETTINGS_SCHEMA.find((def) => def.key === key)?.default;
    expect(defaultOf("theme.light.background")).toBe(nearWhite);
    expect(defaultOf("theme.light.foreground")).toBe(nearBlack);
    expect(defaultOf("theme.dark.background")).toBe(nearBlack);
    expect(defaultOf("theme.dark.foreground")).toBe(nearWhite);
  });
});
