import { describe, expect, test } from "vite-plus/test";
import {
  activeThemePresetName,
  buildThemePresets,
  CUSTOM_THEME_NAME,
  DEFAULT_THEME_PRESET_NAME,
  THEME_PRESETS,
  themePresetWrites,
} from "../src/lib/theme-presets";

const primaries = {
  accent: "#FF6A00",
  background: "#111111",
  foreground: "#FCFCFC",
  translucent: 20,
  contrast: 16,
};

describe("theme presets", () => {
  test("the schema defaults are exactly one preset, listed first", () => {
    // Guards the one duplication in the design: schema defaults and the
    // default preset folder must stay equal, or a fresh install reads Custom.
    expect(DEFAULT_THEME_PRESET_NAME).not.toBe(CUSTOM_THEME_NAME);
    expect(THEME_PRESETS[0].name).toBe(DEFAULT_THEME_PRESET_NAME);
    expect(activeThemePresetName({})).toBe(DEFAULT_THEME_PRESET_NAME);
  });

  test("preset names are unique", () => {
    const names = THEME_PRESETS.map((preset) => preset.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("applying a preset's writes makes it the active preset", () => {
    for (const preset of THEME_PRESETS) {
      const settings = Object.fromEntries(themePresetWrites(preset));
      expect(activeThemePresetName(settings)).toBe(preset.name);
    }
  });

  test("hex comparison ignores case", () => {
    const orange = THEME_PRESETS.find((preset) => preset.name === "Orange");
    expect(orange).toBeDefined();
    const settings = Object.fromEntries(
      themePresetWrites(orange!).map(([key, value]) => [
        key,
        typeof value === "string" ? value.toLowerCase() : value,
      ]),
    );
    expect(activeThemePresetName(settings)).toBe("Orange");
  });

  test("editing one primary reads as Custom", () => {
    const settings = Object.fromEntries(themePresetWrites(THEME_PRESETS[0]));
    settings["theme.dark.accent"] = "#123456";
    expect(activeThemePresetName(settings)).toBe(CUSTOM_THEME_NAME);
  });

  test("folder slugs become title-cased names", () => {
    const presets = buildThemePresets({
      "/shared/themes/warm-paper/light.json": primaries,
      "/shared/themes/warm-paper/dark.json": primaries,
    });
    expect(presets.map((preset) => preset.name)).toEqual(["Warm Paper"]);
  });

  test("a preset missing a mode or a primary fails loudly", () => {
    expect(() => buildThemePresets({ "/shared/themes/half/light.json": primaries })).toThrow(
      /missing dark\.json/,
    );
    const { contrast: _omitted, ...incomplete } = primaries;
    expect(() =>
      buildThemePresets({
        "/shared/themes/half/light.json": primaries,
        "/shared/themes/half/dark.json": incomplete as typeof primaries,
      }),
    ).toThrow(/missing "contrast"/);
  });
});
