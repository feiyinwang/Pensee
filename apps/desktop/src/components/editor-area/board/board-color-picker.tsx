/**
 * Fill and border swatches from the app-wide board palette, with a colour
 * wheel for adding a colour and an edit mode for reordering, replacing and
 * removing them. Lives inside the selection toolbar's popovers.
 * See SPECs/board-color-palette-spec.md.
 */

import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useResetSetting, useSetSetting, useSetting } from "@/hooks/use-settings";
import type { ColorToken } from "./board-model";
import { colorVar } from "./board-render";
import {
  type Hsv,
  type PaletteEntry,
  PALETTE_SETTING,
  addEntry,
  entryOf,
  fillOf,
  hexToHsv,
  hsvToHex,
  moveEntry,
  normalizeHex,
  normalizePalette,
  removeEntry,
  replaceEntry,
  strokeOf,
} from "./board-palette";
import styles from "./board-selection-toolbar.module.css";

// Plain names for the colours the tokens draw (board.css). The keys are the
// stored hue names; `ink` is the text colour ("Default") and `accent` the same.
const LABELS: Record<string, string> = {
  ink: "Default",
  muted: "Gray",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  accent: "Default",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

const nameOf = (e: PaletteEntry) => LABELS[e] ?? e;

// A new custom colour starts on the wheel at the blue dot (#3c72c9).
const START: Hsv = { h: 217, s: 0.7, v: 0.79 };

export function PaletteSwatches({
  kind,
  value,
  onPick,
}: {
  kind: "fill" | "stroke";
  value: ColorToken | undefined;
  onPick: (c: ColorToken) => void;
}) {
  const palette = normalizePalette(useSetting(PALETTE_SETTING));
  const setSetting = useSetSetting();
  const resetSetting = useResetSetting();
  const save = (next: PaletteEntry[]) => void setSetting(PALETTE_SETTING, next);

  const [editing, setEditing] = useState(false);
  /** Open wheel: `index` null adds a colour, a number edits that entry. */
  const [wheel, setWheel] = useState<{ index: number | null; hsv: Hsv } | null>(null);
  const drag = useRef<{ from: number; moved: boolean } | null>(null);

  const label = kind === "fill" ? "Fill" : "Border colour";
  const toColor = kind === "fill" ? fillOf : strokeOf;
  const picked = value === undefined ? null : entryOf(value);

  function openWheel(index: number | null): void {
    const entry = index === null ? null : palette[index];
    const start = entry?.startsWith("#") ? hexToHsv(entry) : null;
    setWheel({ index, hsv: start ?? START });
  }

  /* Pointer-driven reorder: Tauri's native file-drop handler can swallow
     HTML5 drag events, so swatches move under the pointer by hit-testing. */
  function onSwatchPointerDown(e: ReactPointerEvent<HTMLButtonElement>, i: number): void {
    if (!editing) return;
    drag.current = { from: i, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onSwatchPointerMove(e: ReactPointerEvent<HTMLButtonElement>): void {
    const d = drag.current;
    if (!d) return;
    const over = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-palette-index]");
    const to = over ? Number(over.dataset.paletteIndex) : d.from;
    if (to === d.from) return;
    save(moveEntry(palette, d.from, to));
    drag.current = { from: to, moved: true };
  }

  function onSwatchClick(i: number): void {
    const d = drag.current;
    drag.current = null;
    if (editing) {
      if (!d?.moved) openWheel(i);
      return;
    }
    onPick(toColor(palette[i]));
  }

  function confirmWheel(hex: `#${string}`): void {
    if (!wheel) return;
    if (wheel.index === null) {
      save(addEntry(palette, hex));
      onPick(hex);
    } else {
      save(replaceEntry(palette, wheel.index, hex));
    }
    setWheel(null);
  }

  return (
    <div className={styles.palette}>
      <div
        className={styles.swatches}
        role={editing ? "list" : "radiogroup"}
        aria-label={editing ? `${label} palette` : label}
        data-editing={editing || undefined}
      >
        {kind === "fill" && !editing && (
          <button
            type="button"
            role="radio"
            aria-checked={value === "none"}
            aria-label="No fill"
            title="No fill"
            className={styles.swatch}
            data-none
            onClick={() => onPick("none")}
          />
        )}
        {palette.map((entry, i) => (
          <button
            key={entry}
            type="button"
            role={editing ? "listitem" : "radio"}
            aria-checked={editing ? undefined : entry === picked}
            aria-label={editing ? `Edit ${nameOf(entry)}` : `${label}: ${nameOf(entry)}`}
            title={editing ? `${nameOf(entry)} — drag to move, click to change` : nameOf(entry)}
            className={styles.swatch}
            data-palette-index={i}
            data-active={wheel?.index === i || undefined}
            style={{ background: colorVar(toColor(entry)) }}
            onPointerDown={(e) => onSwatchPointerDown(e, i)}
            onPointerMove={onSwatchPointerMove}
            onClick={() => onSwatchClick(i)}
          />
        ))}
        {!editing && (
          <button
            type="button"
            aria-label="Add a colour"
            title="Add a colour"
            className={styles.swatchAdd}
            data-active={(wheel && wheel.index === null) || undefined}
            onClick={() => (wheel?.index === null ? setWheel(null) : openWheel(null))}
          >
            <Plus aria-hidden />
          </button>
        )}
      </div>

      {wheel && (
        <ColorWheel
          key={wheel.index ?? "add"}
          initial={wheel.hsv}
          mode={wheel.index === null ? "add" : "replace"}
          onConfirm={confirmWheel}
          onRemove={
            wheel.index === null
              ? undefined
              : () => {
                  save(removeEntry(palette, wheel.index!));
                  setWheel(null);
                }
          }
          onCancel={() => setWheel(null)}
        />
      )}

      <div className={styles.paletteBar}>
        {editing ? (
          <>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                void resetSetting(PALETTE_SETTING);
                setWheel(null);
              }}
            >
              Reset
            </button>
            <button
              type="button"
              className={styles.textButton}
              data-strong
              onClick={() => {
                setEditing(false);
                setWheel(null);
              }}
            >
              Done
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              setEditing(true);
              setWheel(null);
            }}
          >
            Edit colours
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ wheel */

const WHEEL = 152;

function ColorWheel({
  initial,
  mode,
  onConfirm,
  onRemove,
  onCancel,
}: {
  initial: Hsv;
  mode: "add" | "replace";
  onConfirm: (hex: `#${string}`) => void;
  onRemove?: () => void;
  onCancel: () => void;
}) {
  const [hsv, setHsv] = useState<Hsv>(initial);
  const hex = hsvToHex(hsv);
  const [draft, setDraft] = useState<string | null>(null);

  /* Hue is the angle (0° at the top, clockwise, matching conic-gradient),
     saturation the distance from the centre. */
  function pickAt(e: ReactPointerEvent<HTMLDivElement>): void {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
    setHsv((cur) => ({ ...cur, h, s }));
    setDraft(null);
  }

  const angle = (hsv.h * Math.PI) / 180;
  const knob = {
    left: WHEEL / 2 + Math.sin(angle) * hsv.s * (WHEEL / 2),
    top: WHEEL / 2 - Math.cos(angle) * hsv.s * (WHEEL / 2),
  };

  function commitDraft(): void {
    if (draft === null) return;
    const next = normalizeHex(draft);
    const parsed = next && hexToHsv(next);
    if (parsed) setHsv(parsed);
    setDraft(null);
  }

  return (
    <div className={styles.wheelPanel}>
      <div
        className={styles.wheel}
        style={{ width: WHEEL, height: WHEEL }}
        aria-hidden
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pickAt(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) pickAt(e);
        }}
      >
        <div className={styles.wheelShade} style={{ opacity: 1 - hsv.v }} />
        <span className={styles.wheelKnob} style={{ ...knob, background: hex }} />
      </div>
      <label className={styles.wheelRow}>
        <span className={styles.wheelLabel}>Brightness</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(hsv.v * 100)}
          className={styles.wheelSlider}
          style={{ background: `linear-gradient(to right, #000, ${hsvToHex({ ...hsv, v: 1 })})` }}
          onChange={(e) => setHsv((cur) => ({ ...cur, v: Number(e.target.value) / 100 }))}
        />
      </label>
      <div className={styles.wheelRow}>
        <span className={styles.wheelPreview} style={{ background: hex }} />
        <input
          className={styles.wheelHex}
          aria-label="Hex colour"
          spellCheck={false}
          autoComplete="off"
          value={draft ?? hex}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const next = draft === null ? hex : normalizeHex(draft);
            if (next) onConfirm(next);
          }}
        />
      </div>
      <div className={styles.paletteBar}>
        {onRemove && (
          <button type="button" className={styles.textButton} data-danger onClick={onRemove}>
            Remove
          </button>
        )}
        <button type="button" className={styles.textButton} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.textButton}
          data-strong
          onClick={() => onConfirm(hex)}
        >
          {mode === "add" ? "Add" : "Replace"}
        </button>
      </div>
    </div>
  );
}
