/**
 * Typed registry built from the JSON sources of truth.
 *
 *   - `apps/desktop/shared/settings.schema.json`
 *       The settings *contract*: keys, types, defaults, labels, descriptions,
 *       and CSS-var bindings. Read by Rust (`include_str!` in config.rs) and
 *       imported here statically so TypeScript can derive literal types.
 *
 *   - `apps/desktop/shared/themes/<slug>/{light,dark}.json`
 *       Theme preset *values*, registered by `theme-presets.ts`.
 *
 * Splitting contract from values follows the same separation Rust uses: the
 * schema describes how a setting works; presets are just curated bundles of
 * values that map onto those settings.
 */

import schemaFile from "@shared/settings.schema.json";

// ---------- Typed schema (contract) ----------

type RawSchema = typeof schemaFile;

type RawEntry = RawSchema["settings"][number];

/** Map a schema entry's `type` literal to the runtime value type. Settings
 *  with `cssFormat: "px"` are still numbers in the store — formatting only
 *  happens when writing to CSS. */
type ValueOf<T extends RawEntry> = T["type"] extends "boolean"
  ? boolean
  : T["type"] extends "number" | "range"
    ? number
    : T["type"] extends "list"
      ? string[]
      : string;

/** Compile-time map from setting key → expected runtime type. Drives the
 *  typed `useSetting<K>` accessor and store typings. */
export type SettingsMap = {
  [E in RawEntry as E["key"]]: ValueOf<E>;
};

export type SettingKey = keyof SettingsMap;

type SchemaField<Entry, Key extends PropertyKey> = Entry extends unknown
  ? Key extends keyof Entry
    ? Entry[Key]
    : never
  : never;

type KeysOfUnion<Entry> = Entry extends unknown ? keyof Entry : never;

/** Generalized consumer shape whose field names and values are derived from
 *  the imported JSON contract. Optional properties remain convenient for
 *  generic controls without a cast that can hide schema drift. */
export type SettingDef = {
  [Key in keyof RawEntry]: SchemaField<RawEntry, Key>;
} & {
  [Key in Exclude<KeysOfUnion<RawEntry>, keyof RawEntry>]?: SchemaField<RawEntry, Key>;
};

export const SETTINGS_SCHEMA: readonly SettingDef[] = schemaFile.settings;

// ---------- Theme primaries ----------

export type ThemeMode = "light" | "dark";

export type PrimarySuffix = "accent" | "background" | "foreground" | "translucent" | "contrast";

/** A flat record keyed by the kebab-case suffix of `theme.{mode}.{suffix}`.
 *  Mirrors the JSON schema names so iteration code uses the same key as the
 *  schema entry without any mapping. */
export type PrimarySet = Record<PrimarySuffix, string | number>;

const PRIMARY_PREFIX = (mode: ThemeMode) => `theme.${mode}.`;

/** Schema entries describing the editable primaries for a theme mode. UI
 *  iterates these, write paths iterate these, preset compare iterates these.
 *  The hardcoded list lives only in the JSON schema. */
export function getPrimaryDefs(mode: ThemeMode): SettingDef[] {
  const prefix = PRIMARY_PREFIX(mode);
  return SETTINGS_SCHEMA.filter((def) => def.key.startsWith(prefix));
}

export function suffixOf(mode: ThemeMode, key: string): PrimarySuffix {
  return key.slice(PRIMARY_PREFIX(mode).length) as PrimarySuffix;
}
