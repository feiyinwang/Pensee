import { useRef, type KeyboardEvent } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useSetSetting, useSetting } from "@/hooks/use-settings";
import { SETTINGS_SCHEMA } from "@/lib/settings-schema";

const CONTENT_WIDTH = SETTINGS_SCHEMA.find((def) => def.key === "editor.content-width");
if (typeof CONTENT_WIDTH?.default !== "number" || typeof CONTENT_WIDTH.max !== "number") {
  throw new Error("settings schema: editor.content-width needs a numeric default and max");
}

/** Two page edges with two text lines between them; the lines' length shows
 *  the column width. Drawn as Hugeicons data so it gets the same size and
 *  stroke as every other icon in the chrome. A full frame read as one shape
 *  at this size, so the three widths looked alike; open edges keep them apart. */
function widthGlyph(left: number, right: number): IconSvgElement {
  return [
    [
      "path",
      {
        d: "M3 5V19M21 5V19",
        stroke: "currentColor",
        strokeLinecap: "round",
        strokeWidth: "1.5",
        key: "0",
      },
    ],
    [
      "path",
      {
        d: `M${left} 10H${right}M${left} 14H${right}`,
        stroke: "currentColor",
        strokeLinecap: "round",
        strokeWidth: "1.5",
        key: "1",
      },
    ],
  ];
}

/** Readable is the schema default and Full its maximum, so the presets and
 *  the Preferences slider always agree on what each one means. */
const PRESETS = [
  { label: "Readable", width: CONTENT_WIDTH.default, icon: widthGlyph(10.5, 13.5) },
  { label: "Wide", width: 960, icon: widthGlyph(8.5, 15.5) },
  { label: "Full width", width: CONTENT_WIDTH.max, icon: widthGlyph(6, 18) },
];

/** Status-bar presets for `editor.content-width` (SPECs/editor-content-width-spec.md#presets).
 *  A width set elsewhere (the Preferences slider) leaves none of them checked. */
export function PageWidthPresets() {
  // The schema's JSON import widens "range" to string in SettingsMap, so
  // narrow at runtime, as useBooleanSetting does for booleans.
  const stored: unknown = useSetting("editor.content-width");
  const width = typeof stored === "number" ? stored : null;
  const setSetting = useSetSetting();
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const checkedIndex = PRESETS.findIndex((preset) => preset.width === width);

  const pick = (index: number) => {
    void setSetting("editor.content-width", PRESETS[index].width);
  };

  // Radio group keys: arrows move the choice and focus together.
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + PRESETS.length) % PRESETS.length;
    pick(next);
    buttonsRef.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Page width" className="flex shrink-0 items-center gap-0.5">
      {PRESETS.map((preset, index) => {
        const checked = index === checkedIndex;
        return (
          <button
            key={preset.label}
            ref={(el) => {
              buttonsRef.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={preset.label}
            title={preset.label}
            tabIndex={checked || (checkedIndex === -1 && index === 0) ? 0 : -1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className="flex size-7 items-center justify-center rounded-lg text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-secondary)] aria-checked:bg-[var(--color-bg-selected)] aria-checked:text-[var(--color-text-primary)]"
          >
            <HugeiconsIcon icon={preset.icon} size={18} color="currentColor" strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
