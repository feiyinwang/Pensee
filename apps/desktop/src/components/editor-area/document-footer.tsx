import type { MouseEvent } from "react";
import { useFileStats } from "@/hooks/use-tabs";
import { useBooleanSetting, useSetSetting } from "@/hooks/use-settings";
import { type PenHint, usePenHint } from "./pen-hint-store";
import {
  FOOTER_METRICS,
  showFooterContextMenu,
  type FooterItemSettingKey,
} from "./footer-context-menu";
import { PageWidthPresets } from "./page-width-presets";
import { keyLabel } from "@/lib/platform";

function FooterMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <span className="text-[var(--text-muted)]">{value.toLocaleString()}</span>
      <span>{label}</span>
    </div>
  );
}

/** The second pen's line in the bar's empty left side (SPECs/second-pen-spec.md#the-bottom-bar). */
function PenHintLine({ hint }: { hint: PenHint }) {
  return (
    <div
      className="pen-hint"
      aria-live="polite"
      data-busy={hint.busy || undefined}
      data-resting={hint.resting || undefined}
    >
      {hint.parts.map((part, i) =>
        "key" in part ? (
          <kbd key={i}>{keyLabel(part.key)}</kbd>
        ) : "strong" in part ? (
          <b key={i}>{part.strong}</b>
        ) : "gap" in part ? (
          <span key={i} className="pen-hint-gap" aria-hidden="true" />
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </div>
  );
}

export function DocumentFooter({ filePath }: { filePath: string }) {
  const stats = useFileStats(filePath);
  const setSetting = useSetSetting();
  const visibility: Record<FooterItemSettingKey, boolean> = {
    "statusbar.show-words": useBooleanSetting("statusbar.show-words"),
    "statusbar.show-characters": useBooleanSetting("statusbar.show-characters"),
    "statusbar.show-paragraphs": useBooleanSetting("statusbar.show-paragraphs"),
    "statusbar.show-width": useBooleanSetting("statusbar.show-width"),
  };
  const visibleMetrics = FOOTER_METRICS.filter((metric) => visibility[metric.settingKey]);
  const showWidth = visibility["statusbar.show-width"];
  const penHint = usePenHint(filePath);

  if (visibleMetrics.length === 0 && !showWidth && !penHint) return null;

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    void showFooterContextMenu({
      visibility,
      onToggle: (key, visible) => {
        void setSetting(key, visible);
      },
    });
  };

  // Solid, so the text scrolling under the bar never shows through it.
  return (
    <div
      data-document-footer
      onContextMenu={handleContextMenu}
      className="flex absolute bottom-0 w-full z-10 h-11 shrink-0 rounded-b-[inherit] bg-[var(--color-bg-canvas)] items-center justify-end gap-5 pl-6 pr-[var(--agent-launcher-clearance,1.5rem)] font-[family-name:var(--mono-font)] text-caption leading-[1.15] text-[var(--text-muted)] md:pl-8 md:pr-[var(--agent-launcher-clearance,2rem)]"
    >
      {penHint && <PenHintLine hint={penHint} />}
      {showWidth && <PageWidthPresets />}
      {visibleMetrics.map((metric) => (
        <FooterMetric
          key={metric.settingKey}
          label={metric.footerLabel}
          value={stats[metric.statKey]}
        />
      ))}
    </div>
  );
}
