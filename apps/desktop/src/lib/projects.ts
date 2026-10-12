import { stringify } from "yaml";
import type { TypedNote } from "./tauri";

// Project views (SPECs/project-views-spec.md): one model behind List, Kanban
// and Timeline, so a project shows the same status and dates in each.

/** A calendar day as days since 1970-01-01, so day math is plain integers. */
export type Day = number;

export interface StatusColumn {
  id: string;
  label: string;
}

export interface Project {
  note: TypedNote;
  /** The id of the status column it sits in. */
  status: string;
  start: Day | null;
  deadline: Day | null;
}

export const NO_STATUS = "none";

/** The `Type` that makes a note a project. */
export const PROJECT_TYPE = "Project";

const BASE_COLUMNS: readonly StatusColumn[] = [
  { id: NO_STATUS, label: "No status" },
  { id: "to-do", label: "To-do" },
  { id: "ongoing", label: "Ongoing" },
  { id: "done", label: "Done" },
];

const STATUS_ALIASES: Record<string, string> = {
  todo: "to-do",
  "to do": "to-do",
  "to-do": "to-do",
  ongoing: "ongoing",
  "in progress": "ongoing",
  "in-progress": "ongoing",
  doing: "ongoing",
  active: "ongoing",
  done: "done",
  complete: "done",
  completed: "done",
  finished: "done",
};

/** Frontmatter keys, lower-cased as `list_typed_notes` returns them. The first
 *  of each list is the name a new key is written with. */
export const STATUS_KEYS = ["Status"] as const;
export const START_KEYS = ["Start", "Start date", "Start_date", "Starting date", "Starting_date"];
export const DEADLINE_KEYS = ["Deadline", "Due", "End date", "End_date", "Ending_date"];
/** When the vault's template made the note: a start when none is set, never written. */
const CREATED_KEYS = ["Dates", "Creation Dates"];

function statusId(raw: string | undefined): string {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "") return NO_STATUS;
  return STATUS_ALIASES[value] ?? value;
}

function firstProperty(note: TypedNote, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = note.properties[key.toLowerCase()];
    if (value !== undefined && value.trim() !== "") return value;
  }
  return undefined;
}

const DATE_RE = /^\[{0,2}(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?\]{0,2}$/;

/** `2023-01-30`, `2023-01-30 16:32` or `[[2023-01-30]]` as a day; null otherwise. */
export function parseDay(value: string | undefined): Day | null {
  const match = value?.trim().match(DATE_RE);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.round(ms / 86_400_000);
}

export function dayToIso(day: Day): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function dayToDate(day: Day): Date {
  return new Date(day * 86_400_000);
}

/** Today in the local calendar. */
export function today(): Day {
  const now = new Date();
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
}

const dayFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayYearFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Mar 4", with the year when it isn't this year's. */
export function formatDay(day: Day): string {
  const date = dayToDate(day);
  const thisYear = dayToDate(today()).getUTCFullYear();
  return (date.getUTCFullYear() === thisYear ? dayFormat : dayYearFormat).format(date);
}

export function projectOf(note: TypedNote): Project {
  return {
    note,
    status: statusId(firstProperty(note, STATUS_KEYS)),
    start: parseDay(firstProperty(note, START_KEYS)) ?? parseDay(firstProperty(note, CREATED_KEYS)),
    deadline: parseDay(firstProperty(note, DEADLINE_KEYS)),
  };
}

/** The base columns, then each other status the projects use, in the order first seen. */
export function statusColumns(projects: readonly Project[]): StatusColumn[] {
  const columns = [...BASE_COLUMNS];
  const known = new Set(columns.map((c) => c.id));
  for (const project of projects) {
    if (known.has(project.status)) continue;
    known.add(project.status);
    const raw = firstProperty(project.note, STATUS_KEYS)?.trim() ?? project.status;
    columns.splice(columns.length - 1, 0, { id: project.status, label: raw });
  }
  return columns;
}

export function statusLabel(columns: readonly StatusColumn[], id: string): string {
  return columns.find((c) => c.id === id)?.label ?? id;
}

/** Tag colours, Notion's palette. Each carries one meaning: blue is work in
 *  progress, green is done, red is overdue, orange is due soon, gray is
 *  neither; the rest tell apart statuses the vault adds itself. */
export type TagTone =
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

const STATUS_TONES: Record<string, TagTone> = { "to-do": "gray", ongoing: "blue", done: "green" };
/** Colours left for statuses the vault adds: none of the ones with a meaning. */
const OTHER_TONES: readonly TagTone[] = ["purple", "brown", "pink", "yellow"];

/** The tag colour of a status column; null for No status, which has no tag. */
export function statusTone(id: string): TagTone | null {
  if (id === NO_STATUS) return null;
  return STATUS_TONES[id] ?? OTHER_TONES[hash(id) % OTHER_TONES.length];
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(h, 31) + text.charCodeAt(i)) >>> 0;
  return h;
}

/** Days ahead that count as due soon. */
export const DUE_SOON_DAYS = 7;

/** A project's deadline as a tag: red and "Overdue" once it has passed,
 *  orange within a week, gray otherwise and for any done project. */
export function deadlineTag(project: Project, now: Day): { tone: TagTone; label: string } | null {
  if (project.deadline === null) return null;
  const date = formatDay(project.deadline);
  if (project.status === "done") return { tone: "gray", label: `Due ${date}` };
  const days = project.deadline - now;
  if (days < 0) return { tone: "red", label: `Overdue · ${date}` };
  if (days === 0) return { tone: "orange", label: "Due today" };
  if (days === 1) return { tone: "orange", label: "Due tomorrow" };
  if (days <= DUE_SOON_DAYS) return { tone: "orange", label: `Due ${date}` };
  return { tone: "gray", label: `Due ${date}` };
}

/** The value a column writes into `Status` (No status writes it empty). */
export function statusValue(column: StatusColumn): string {
  return column.id === NO_STATUS ? "" : column.label;
}

/** The changes a project view asks for; a field left out is left alone. */
export interface ProjectEdit {
  status?: string;
  start?: Day;
  deadline?: Day;
}

/** `frontmatter` with `edit` applied, each field written into the key the note
 *  already uses for it, else added under its first name. */
export function withProjectEdit(frontmatter: string | null, edit: ProjectEdit): string | null {
  let next = frontmatter;
  if (edit.status !== undefined) next = withProperty(next, STATUS_KEYS, edit.status);
  if (edit.start !== undefined) next = withProperty(next, START_KEYS, dayToIso(edit.start));
  if (edit.deadline !== undefined)
    next = withProperty(next, DEADLINE_KEYS, dayToIso(edit.deadline));
  return next;
}

/** A new project note: `Type: Project`, then the fields `edit` sets, written
 *  the way `withProjectEdit` writes them so the views read them back. */
export function projectNoteContent(edit: ProjectEdit): string {
  return `---\n${withProjectEdit(`Type: ${PROJECT_TYPE}`, edit)}\n---\n`;
}

const KEY_LINE_RE = /^([^\s#:-][^:]*):(.*)$/;

/**
 * `frontmatter` with the top-level key matching one of `keys` (ignoring case)
 * set to `value`: its line and any indented or `- ` continuation lines become
 * one `Key: value` line, keeping the key as written. A missing key is added as
 * the last line under `keys[0]`. Every other line stays byte for byte — this
 * reads keys the way `list_typed_notes` does, line by line.
 */
export function withProperty(
  frontmatter: string | null,
  keys: readonly string[],
  value: string,
): string {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  const scalar = value === "" ? "" : ` ${stringify(value, { lineWidth: 0 }).trimEnd()}`;
  const lines = frontmatter === null || frontmatter === "" ? [] : frontmatter.split("\n");
  // The key the note uses, in the order `keys` prefers them.
  let at = -1;
  let rank = Infinity;
  lines.forEach((line, i) => {
    const key = line.match(KEY_LINE_RE)?.[1]?.trim().toLowerCase();
    if (key === undefined || !wanted.has(key)) return;
    const r = keys.findIndex((k) => k.toLowerCase() === key);
    if (r < rank) {
      rank = r;
      at = i;
    }
  });
  if (at === -1) return [...lines, `${keys[0]}:${scalar}`].join("\n");
  const key = lines[at].match(KEY_LINE_RE)![1];
  let end = at + 1;
  while (end < lines.length && /^(\s|- )/.test(lines[end]) && lines[end].trim() !== "") end += 1;
  const line = `${key}:${scalar}`;
  if (end === at + 1 && lines[at] === line) return frontmatter ?? "";
  return [...lines.slice(0, at), line, ...lines.slice(end)].join("\n");
}
