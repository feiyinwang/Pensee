import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Calendar } from "@/components/arc/calendar/calendar";
import { DropdownMenu } from "@/components/arc/dropdown-menu/dropdown-menu";
import { ensureArcTokens } from "@/components/editor-area/board/arc-tokens";
import { openPeriodNote } from "@/hooks/use-daily-note";
import { useSidebarMetadataVersion } from "@/hooks/use-file-tree";
import { useWorkspaceRoot } from "@/hooks/use-workspace";
import { resolveDailyNoteFile } from "@/lib/daily-note";
import { getFileStem, getParentDir } from "@/lib/paths";
import { isoWeek, periodNoteStem, type PeriodKind } from "@/lib/periodic-notes";
import * as tauri from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import "./calendar-panel.css";

type View = "days" | "months" | "years";

const VIEWS: { value: View; label: string }[] = [
  { value: "days", label: "Days" },
  { value: "months", label: "Months" },
  { value: "years", label: "Years" },
];

const DAY_STEM = /^(\d{4})-(\d{2})-(\d{2})$/;

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** Cmd+click (Ctrl+click off the Mac) opens the note in a column to the right. */
function wantsBeside(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return IS_MAC ? event.metaKey : event.ctrlKey;
}

/** The daily-note folder, or null without a workspace or with a folder setting
 *  that escapes it (opening a note reports that error). */
function useNoteFolder(): string | null {
  const root = useWorkspaceRoot();
  const folder = useSettingsStore(
    (state) => (state.settings["workspace.daily-note-folder"] as string | undefined) ?? "",
  );
  if (!root) return null;
  const probe = resolveDailyNoteFile(root, folder, "_.md");
  return probe.ok ? getParentDir(probe.path) : null;
}

/** Stems of the `.md` files in the note folder, re-read whenever the watcher
 *  reports a change, so a note created anywhere gets its dot. Names only: a
 *  listing that opened every note (`readDirectory`) took a minute in an iCloud
 *  vault and, re-run on each watcher event, starved the clicks' own file reads. */
function useExistingStems(folder: string | null): Set<string> {
  const version = useSidebarMetadataVersion();
  const [stems, setStems] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!folder) return;
    let cancelled = false;
    tauri
      .listMarkdownStems(folder)
      .then((names) => !cancelled && setStems(new Set(names)))
      .catch((error) => {
        if (cancelled) return;
        console.error(`Calendar: listing ${folder} failed`, error);
        setStems(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [folder, version]);
  return stems;
}

interface CellState {
  exists: boolean;
  isOpen: boolean;
  isCurrent: boolean;
  onOpen: () => void;
}
type CellFor = (kind: PeriodKind, date: Date) => CellState;

/**
 * Right-hand calendar (Cmd+]): click a day, week, month, quarter or year to
 * create-or-open its note. Days use Arc's Calendar; months and years are the
 * same cells laid out by period. See SPECs/calendar-panel-spec.md.
 */
export default function CalendarPanelContent() {
  ensureArcTokens();
  const [view, setView] = useState<View>("days");
  // The month shown in the days view; its year drives the other two views.
  const [month, setMonth] = useState(() => new Date());
  const now = new Date();
  const folder = useNoteFolder();
  const stems = useExistingStems(folder);
  const activePath = useEditorStore((state) => state.activeFilePath);
  const activeStem =
    folder && activePath && getParentDir(activePath) === folder ? getFileStem(activePath) : null;
  const openDay = activeStem?.match(DAY_STEM);
  // Arc's Calendar reports a picked day without its event, so the modifier of
  // the click (or Enter) that picked it is caught on the way down.
  const besideRef = useRef(false);
  const noteModifier = (event: SyntheticEvent<HTMLElement, MouseEvent | KeyboardEvent>) => {
    besideRef.current = wantsBeside(event.nativeEvent);
  };

  const cell: CellFor = (kind, date) => {
    const stem = periodNoteStem(kind, date);
    return {
      exists: stems.has(stem),
      isOpen: stem === activeStem,
      isCurrent: stem === periodNoteStem(kind, now),
      onOpen: () => void openPeriodNote(kind, date, besideRef.current),
    };
  };

  const year = month.getFullYear();
  const decadeStart = year - (year % 10);
  const step = (direction: 1 | -1) =>
    setMonth((current) =>
      view === "days"
        ? new Date(current.getFullYear(), current.getMonth() + direction, 1)
        : new Date(current.getFullYear() + direction * (view === "months" ? 1 : 10), 0, 1),
    );
  const title =
    view === "days"
      ? month.toLocaleString(undefined, { month: "long", year: "numeric" })
      : view === "months"
        ? String(year)
        : `${decadeStart}–${decadeStart + 9}`;
  const unit = view === "days" ? "month" : view === "months" ? "year" : "decade";

  return (
    <aside aria-label="Calendar" className="calendar-panel flex h-full flex-col">
      {/* The tab row holds only the panel toggle (placed by app-layout), like the sidebar's header. */}
      <div className="calendar-panel-chrome shrink-0" />

      <div className="calendar-panel-header">
        <div className="calendar-panel-view">
          <DropdownMenu
            label={title}
            // Item labels start under the title's text (measured: the menu's
            // inset, item padding and check column, less the trigger padding).
            align="start"
            alignOffset={-30}
            items={VIEWS.map((option) => ({
              label: option.label,
              icon: view === option.value ? <Check size={15} strokeWidth={2} /> : <span />,
              onSelect: () => setView(option.value),
            }))}
          />
        </div>
        <div className="calendar-panel-nav">
          <HeaderButton onClick={() => setMonth(new Date())}>Today</HeaderButton>
          <HeaderButton label={`Previous ${unit}`} onClick={() => step(-1)} icon>
            <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          </HeaderButton>
          <HeaderButton label={`Next ${unit}`} onClick={() => step(1)} icon>
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
          </HeaderButton>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto pb-3"
        onClickCapture={noteModifier}
        onKeyDownCapture={noteModifier}
      >
        {view === "days" && (
          <Calendar
            month={month}
            onMonthChange={setMonth}
            value={
              openDay
                ? new Date(Number(openDay[1]), Number(openDay[2]) - 1, Number(openDay[3]))
                : undefined
            }
            onChange={(date) => void openPeriodNote("day", date, besideRef.current)}
            markedDates={(date) => stems.has(periodNoteStem("day", date))}
            weekStartsOn={1}
            weekLabel={(monday) => (
              <PeriodCell state={cell("week", monday)} label={`W${isoWeek(monday).week}`} small />
            )}
            className="calendar-panel-calendar"
          />
        )}
        {view === "months" && (
          <>
            <div className="calendar-panel-grid calendar-panel-grid--labelled">
              {[0, 1, 2, 3].map((quarter) => [
                <PeriodCell
                  key={`q${quarter}`}
                  state={cell("quarter", new Date(year, quarter * 3, 1))}
                  label={`Q${quarter + 1}`}
                  small
                />,
                ...[0, 1, 2].map((offset) => {
                  const date = new Date(year, quarter * 3 + offset, 1);
                  return (
                    <PeriodCell
                      key={offset}
                      state={cell("month", date)}
                      label={date.toLocaleString(undefined, { month: "short" })}
                    />
                  );
                }),
              ])}
            </div>
          </>
        )}
        {view === "years" && (
          <>
            <div className="calendar-panel-grid">
              {/* The decade plus one year either side, three to a row. */}
              {Array.from({ length: 12 }, (_, i) => decadeStart - 1 + i).map((y) => (
                <PeriodCell
                  key={y}
                  state={cell("year", new Date(y, 0, 1))}
                  label={String(y)}
                  muted={y < decadeStart || y > decadeStart + 9}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function HeaderButton({
  label,
  onClick,
  icon = false,
  children,
}: {
  label?: string;
  onClick: () => void;
  icon?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`calendar-panel-nav-button${icon ? " calendar-panel-nav-button--icon" : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * One clickable week, month, quarter or year, drawn like an Arc Calendar day:
 * the current period reads in the accent, the open note gets the accent fill,
 * and an existing note shows a dot under its label.
 */
function PeriodCell({
  state,
  label,
  muted = false,
  small = false,
}: {
  state: CellState;
  label: string;
  muted?: boolean;
  /** The week and quarter column: smaller, muted text. */
  small?: boolean;
}) {
  return (
    <button
      type="button"
      className="calendar-panel-cell"
      data-muted={muted || small || undefined}
      data-small={small || undefined}
      data-current={state.isCurrent || undefined}
      data-open={state.isOpen || undefined}
      data-marked={state.exists || undefined}
      aria-current={state.isOpen ? "page" : undefined}
      onClick={state.onOpen}
    >
      <span className="calendar-panel-cell-label">{label}</span>
    </button>
  );
}
