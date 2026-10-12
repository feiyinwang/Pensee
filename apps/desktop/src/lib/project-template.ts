import { isProjectType, noteType } from "./projects";
import { parseFrontmatter } from "./frontmatter";

// New projects from the Projects views (SPECs/project-views-spec.md) are made
// from the vault's own project template: the Templater folder template whose
// note is `Type: Project`, in that folder, with the Templater tags Writer can
// fill filled in, so a project made here has what one made in Obsidian has.

/** Where Templater keeps its settings, from the vault root. */
export const TEMPLATER_SETTINGS = ".obsidian/plugins/templater-obsidian/data.json";

export interface FolderTemplate {
  /** Vault-relative folder a note made there gets the template in. */
  folder: string;
  /** Vault-relative path of the template note. */
  template: string;
}

/** Templater's folder → template pairs; empty when the settings have none or
 *  can't be read as JSON. */
export function folderTemplates(settings: string): FolderTemplate[] {
  let data: unknown;
  try {
    data = JSON.parse(settings);
  } catch {
    return [];
  }
  const pairs = (data as { folder_templates?: unknown })?.folder_templates;
  if (!Array.isArray(pairs)) return [];
  return pairs.flatMap((pair: unknown) => {
    const { folder, template } = (pair ?? {}) as Record<string, unknown>;
    if (typeof folder !== "string" || typeof template !== "string") return [];
    const cleanFolder = folder.replace(/^\/+|\/+$/g, "");
    if (cleanFolder === "" || template.trim() === "") return [];
    return [{ folder: cleanFolder, template: template.replace(/^\/+/, "") }];
  });
}

/** Whether a template note's content makes project notes. */
export function isProjectTemplate(content: string): boolean {
  return isProjectType(noteType(parseFrontmatter(content).frontmatter));
}

const TAG_RE = /<%[-_*]?([\s\S]*?)[-_]?%>/g;
const DATE_CALL_RE = /^tp\.(?:file\.creation_date|date\.now)\(\s*(?:(["'])(.*?)\1)?\s*\)$/;
/** Templater's own default for `tp.file.creation_date()`. */
const DEFAULT_DATE_FORMAT = "YYYY-MM-DD HH:mm";

/** `date` in a moment-style `format`: YYYY, MM, DD, HH, mm and ss; anything
 *  else stays as written. */
export function formatMoment(date: Date, format: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const parts: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  };
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => parts[token]);
}

/** `content` with the Templater tags filled the way Templater would for a new
 *  note called `title` made at `now`: `tp.file.title`, and
 *  `tp.file.creation_date(…)` / `tp.date.now(…)` with a plain format. Any other
 *  tag (a cursor, a prompt, a script) can't run here and is dropped, so no
 *  `<% … %>` is left in the note. */
export function fillTemplate(content: string, title: string, now: Date): string {
  return content.replace(TAG_RE, (_, code: string) => {
    const call = code.trim();
    if (call === "tp.file.title") return title;
    const date = call.match(DATE_CALL_RE);
    if (date) return formatMoment(now, date[2] || DEFAULT_DATE_FORMAT);
    return "";
  });
}
