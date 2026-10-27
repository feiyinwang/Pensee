import { Fragment, useMemo, type ComponentType } from "react";
import { useAllSettings, useResetSetting, useSetSetting } from "@/hooks/use-settings";
import { SETTINGS_SCHEMA, type SettingDef } from "@/lib/settings-schema";
import { SettingControl } from "./setting-control";
import { ThemesSection } from "./themes-section";
import { ClaudeAccountRow } from "./claude-account-row";
import { TranscriptionRows } from "./transcription-row";
import { IS_MAC } from "@/lib/platform";

/** Account rows, each after the setting it belongs with: the Claude sign-in
 *  after the model the Agent uses; the Whisper download and the ElevenLabs
 *  key after the Whisper model. */
const ACCOUNT_ROWS_AFTER: Partial<Record<string, ComponentType<{ isShown: boolean }>>> = {
  "agent.model": ClaudeAccountRow,
  "talk.whisper-model": TranscriptionRows,
};
import { EditorScrollContainer } from "@/components/editor-area/editor-scroll-container";

/** Section that renders above the Themes block. The schema-driven section
 *  list is rendered in two passes — these come first, the Themes section
 *  comes next, and everything else is rendered after. */
const SECTIONS_BEFORE_THEMES = ["Appearance", "Typography"] as const;

export function SettingsPanel({ isShown = true }: { isShown?: boolean }) {
  const settings = useAllSettings();
  const setSetting = useSetSetting();
  const resetSetting = useResetSetting();

  const categories = useMemo(() => {
    const map = new Map<string, SettingDef[]>();
    for (const def of SETTINGS_SCHEMA) {
      // Theme settings are owned by ThemesSection; keep them out of the generic renderer.
      if (def.category === "Theme") continue;
      // The Apple Books import exists only on macOS. `apple-books.folder` stays:
      // every book import (lib/book-import.ts) makes its pages there.
      if (!IS_MAC && def.key === "apple-books.sync") continue;
      const existing = map.get(def.category) ?? [];
      existing.push(def);
      map.set(def.category, existing);
    }
    return map;
  }, []);

  function isModified(def: SettingDef): boolean {
    return JSON.stringify(settings[def.key]) !== JSON.stringify(def.default);
  }

  function renderSection(category: string, defs: SettingDef[]) {
    return (
      <section key={category} className="mb-10">
        <h2 className="mb-3 text-caption font-medium text-[var(--text-muted)]">{category}</h2>
        <div className="-mx-4 overflow-hidden rounded-2xl border border-[var(--line-subtler)] bg-[var(--surface-card)]">
          {defs.map((def, i) => {
            const AccountRow = ACCOUNT_ROWS_AFTER[def.key];
            return (
              <Fragment key={def.key}>
                <div className={i === 0 ? undefined : "border-t border-[var(--line-subtler)]"}>
                  <SettingControl
                    def={def}
                    value={settings[def.key]}
                    onChange={(value) => setSetting(def.key, value)}
                    onReset={() => void resetSetting(def.key)}
                    isModified={isModified(def)}
                  />
                </div>
                {AccountRow && (
                  <div className="border-t border-[var(--line-subtler)]">
                    <AccountRow isShown={isShown} />
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </section>
    );
  }

  const beforeThemes: [string, SettingDef[]][] = [];
  for (const cat of SECTIONS_BEFORE_THEMES) {
    const defs = categories.get(cat);
    if (defs) beforeThemes.push([cat, defs]);
  }

  const beforeThemesSet = new Set<string>(SECTIONS_BEFORE_THEMES);
  const afterThemes = Array.from(categories.entries()).filter(([cat]) => !beforeThemesSet.has(cat));

  return (
    <div data-settings-panel className="relative z-10 h-full">
      <EditorScrollContainer>
        <div className="mx-auto max-w-2xl px-8 pt-20 pb-24 md:pt-24">
          <h1 className="mb-10 text-2xl font-semibold text-[var(--text-primary)]">Preferences</h1>

          {beforeThemes.map(([cat, defs]) => renderSection(cat, defs))}

          <ThemesSection />

          {afterThemes.map(([cat, defs]) => renderSection(cat, defs))}
        </div>
      </EditorScrollContainer>
    </div>
  );
}
