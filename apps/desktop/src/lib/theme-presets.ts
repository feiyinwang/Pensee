/**
 * Theme presets: curated bundles of the five theme primaries for both modes.
 *
 * Each preset is a folder under `shared/themes/<slug>/` holding `light.json`
 * and `dark.json`. The glob picks folders up automatically, so adding a theme
 * is adding a folder; the slug becomes the display name (`high-contrast` →
 * "High Contrast").
 *
 * A preset is not stored anywhere. The primaries (`theme.{mode}.*`) stay the
 * single source of truth: choosing a preset writes them, and the active preset
 * is whichever one they currently match. Editing any primary by hand therefore
 * reads back as "Custom" with no sentinel to keep in sync.
 */

import {
  getPrimaryDefs,
  suffixOf,
  type PrimarySet,
  type PrimarySuffix,
  type ThemeMode,
} from "./settings-schema";

export interface ThemePreset {
  name: string;
  light: PrimarySet;
  dark: PrimarySet;
}

export const CUSTOM_THEME_NAME = "Custom";

const MODES: readonly ThemeMode[] = ["light", "dark"];

const presetFiles = import.meta.glob<PrimarySet>("@shared/themes/*/*.json", {
  eager: true,
  import: "default",
});

function slugToDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part.length === 0 ? "" : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

/** Build presets from glob results. Exported for tests; the app uses
 *  `THEME_PRESETS`. Throws on a folder missing a mode or a primary, so a
 *  half-written preset fails at startup instead of applying partially. */
export function buildThemePresets(files: Record<string, PrimarySet>): ThemePreset[] {
  const bySlug = new Map<string, Partial<Record<ThemeMode, PrimarySet>>>();
  for (const [path, primaries] of Object.entries(files)) {
    const match = path.match(/themes\/([^/]+)\/(light|dark)\.json$/);
    if (!match) continue;
    const [, slug, mode] = match;
    const bundle = bySlug.get(slug) ?? {};
    bundle[mode as ThemeMode] = primaries;
    bySlug.set(slug, bundle);
  }

  const presets: ThemePreset[] = [];
  for (const [slug, bundle] of bySlug) {
    for (const mode of MODES) {
      const primaries = bundle[mode];
      if (!primaries) throw new Error(`Theme preset "${slug}" is missing ${mode}.json`);
      for (const def of getPrimaryDefs(mode)) {
        const suffix = suffixOf(mode, def.key);
        if (primaries[suffix] === undefined) {
          throw new Error(`Theme preset "${slug}" ${mode}.json is missing "${suffix}"`);
        }
      }
    }
    presets.push({ name: slugToDisplayName(slug), light: bundle.light!, dark: bundle.dark! });
  }
  return presets;
}

function primaryValuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function readPrimary(
  mode: ThemeMode,
  suffix: PrimarySuffix,
  settings: Record<string, unknown>,
): unknown {
  const def = getPrimaryDefs(mode).find((d) => suffixOf(mode, d.key) === suffix);
  const value = def ? settings[def.key] : undefined;
  return value ?? def?.default;
}

function presetMatches(preset: ThemePreset, settings: Record<string, unknown>): boolean {
  return MODES.every((mode) =>
    getPrimaryDefs(mode).every((def) => {
      const suffix = suffixOf(mode, def.key);
      return primaryValuesEqual(readPrimary(mode, suffix, settings), preset[mode][suffix]);
    }),
  );
}

/** The preset the current primaries match, or `CUSTOM_THEME_NAME`. Unset keys
 *  count as their schema default, so a fresh config matches the default. */
export function activeThemePresetName(
  settings: Record<string, unknown>,
  presets: readonly ThemePreset[] = THEME_PRESETS,
): string {
  return presets.find((preset) => presetMatches(preset, settings))?.name ?? CUSTOM_THEME_NAME;
}

/** The setting writes that apply `preset`, one per primary per mode. */
export function themePresetWrites(preset: ThemePreset): [key: string, value: string | number][] {
  return MODES.flatMap((mode) =>
    getPrimaryDefs(mode).map(
      (def) => [def.key, preset[mode][suffixOf(mode, def.key)]] as [string, string | number],
    ),
  );
}

const UNORDERED_PRESETS = buildThemePresets(presetFiles);

/** The preset equal to the schema defaults, i.e. what a fresh install shows. */
export const DEFAULT_THEME_PRESET_NAME = activeThemePresetName({}, UNORDERED_PRESETS);

/** Default preset first, the rest alphabetical. */
export const THEME_PRESETS: readonly ThemePreset[] = [...UNORDERED_PRESETS].sort((a, b) => {
  if (a.name === DEFAULT_THEME_PRESET_NAME) return -1;
  if (b.name === DEFAULT_THEME_PRESET_NAME) return 1;
  return a.name.localeCompare(b.name);
});
