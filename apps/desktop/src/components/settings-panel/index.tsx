import { Fragment, useMemo, type ComponentType } from "react";
import { useAllSettings, useResetSetting, useSetSetting } from "@/hooks/use-settings";
import { SETTINGS_SCHEMA, type SettingDef } from "@/lib/settings-schema";
import { SettingControl } from "./setting-control";
import { ThemesSection } from "./themes-section";
import { ClaudeAccountRow } from "./claude-account-row";
import { XAccountRow } from "./x-account-row";

/** Account rows, each after the setting it belongs with: the X sign-in after
 *  the Client ID it needs, the Claude sign-in after the model the Agent uses. */
const ACCOUNT_ROWS_AFTER: Partial<Record<string, ComponentType<{ isShown: boolean }>>> = {
  "x-bookmarks.client-id": XAccountRow,
  "agent.model": ClaudeAccountRow,
};
import { EditorScrollContainer } from "@/components/editor-area/editor-scroll-container";

/** Section that renders above the Themes block. The schema-driven section
 *  list is rendered in two passes — these come first, the Themes section
 *  comes next, and everything else is rendered after. */
const SECTIONS_BEFORE_THEMES = ["Appearance", "Typography"] as const;

export function SettingsPanel({
  isActive,
  inColumn = false,
}: {
  isActive: boolean;
  inColumn?: boolean;
}) {
  const isShown = isActive || inColumn;
  const settings = useAllSettings();
  const setSetting = useSetSetting();
  const resetSetting = useResetSetting();

  const categories = useMemo(() => {
    const map = new Map<string, SettingDef[]>();
    for (const def of SETTINGS_SCHEMA) {
      // Theme settings are owned by ThemesSection; keep them out of the generic renderer.
      if (def.category === "Theme") continue;
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
    <div
      data-settings-panel
      className={
        isShown ? "relative z-10 h-full" : "absolute inset-0 invisible pointer-events-none h-full"
      }
      aria-hidden={!isShown}
    >
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
