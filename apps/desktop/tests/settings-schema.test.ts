import { describe, expect, test } from "vite-plus/test";
import {
  getPrimaryDefs,
  SETTINGS_SCHEMA,
  suffixOf,
  type ThemeMode,
} from "../src/lib/settings-schema";

// Every preset folder ships one JSON per mode holding exactly the editable
// primaries. Glob-load them the same way a preset picker would so adding a
// schema primary (e.g. mono-font) fails here until every preset defines it.
const presetFiles = import.meta.glob<Record<string, unknown>>("../shared/themes/*/*.json", {
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

describe("theme presets", () => {
  test("at least one preset file is discovered", () => {
    expect(Object.keys(presetFiles).length).toBeGreaterThan(0);
  });

  test("define every editable primary from the settings schema", () => {
    for (const [path, preset] of Object.entries(presetFiles)) {
      const mode: ThemeMode = path.endsWith("/dark.json") ? "dark" : "light";
      const schemaKeys = getPrimaryDefs(mode)
        .map((def) => suffixOf(mode, def.key))
        .sort();
      expect(Object.keys(preset).sort(), path).toEqual(schemaKeys);
    }
  });
});
