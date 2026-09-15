import { useAllSettings, useSetSetting } from "@/hooks/use-settings";
import type { SettingDef } from "@/lib/settings-schema";
import {
  activeThemePresetName,
  CUSTOM_THEME_NAME,
  DEFAULT_THEME_PRESET_NAME,
  THEME_PRESETS,
  themePresetWrites,
} from "@/lib/theme-presets";
import { SettingControl } from "./setting-control";

const PRESET_NAMES = THEME_PRESETS.map((preset) => preset.name);

// Not a schema entry: the dropdown has no stored value of its own. It reads
// the active preset off the theme primaries and writes them back (see
// `lib/theme-presets.ts`), so it only borrows the row layout of a setting.
const THEME_PRESET_DEF = {
  key: "appearance.theme-preset",
  label: "Theme",
  description: "Colors for both light and dark mode. Fine-tune them under Light and Dark Theme.",
  category: "Appearance",
  type: "enum",
  options: PRESET_NAMES,
  default: DEFAULT_THEME_PRESET_NAME,
} as SettingDef;

export function ThemePresetRow() {
  const settings = useAllSettings();
  const setSetting = useSetSetting();
  const activeName = activeThemePresetName(settings);
  // "Custom" is only listed while it is the truth, so the select can show it;
  // choosing it is a no-op because there is nothing to apply.
  const options = activeName === CUSTOM_THEME_NAME ? [...PRESET_NAMES, activeName] : PRESET_NAMES;

  function applyPreset(name: unknown) {
    const preset = THEME_PRESETS.find((candidate) => candidate.name === name);
    if (!preset) return;
    for (const [key, value] of themePresetWrites(preset)) {
      void setSetting(key, value);
    }
  }

  return (
    <SettingControl
      def={{ ...THEME_PRESET_DEF, options }}
      value={activeName}
      onChange={applyPreset}
      onReset={() => applyPreset(DEFAULT_THEME_PRESET_NAME)}
      isModified={activeName !== DEFAULT_THEME_PRESET_NAME}
    />
  );
}
