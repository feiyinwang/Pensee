import { isProjectType, noteType } from "./projects";
import { parseFrontmatter } from "./frontmatter";

// New projects (SPECs/project-views-spec.md) go in the folder of the vault's
// project template: the Templater folder template whose note is
// `Type: Project`. Only the folder is used; the note starts empty, with none
// of the template's properties or sections.

/** Where Templater keeps its settings, from the vault root. */
export const TEMPLATER_SETTINGS = ".obsidian/plugins/templater-obsidian/data.json";

// Notes in the vault's template folder are templates, not entries: no space
// lists them and Add project never offers them (SPECs/spaces-spec.md).

/** Where Obsidian's core Templates plugin keeps its settings, from the vault root. */
export const CORE_TEMPLATES_SETTINGS = ".obsidian/templates.json";

/** The vault-relative template folder a settings file names under `key`
 *  (Templater: `templates_folder`; core Templates: `folder`); null when it
 *  names none, names the vault root, or can't be read as JSON. */
export function templateFolder(
  settings: string,
  key: "templates_folder" | "folder",
): string | null {
  let data: unknown;
  try {
    data = JSON.parse(settings);
  } catch {
    return null;
  }
  const folder = (data as Record<string, unknown> | null)?.[key];
  if (typeof folder !== "string") return null;
  const clean = folder
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .normalize("NFC");
  return clean === "" ? null : clean;
}

/** Whether the vault-relative `path` is one of `folders` or inside one. */
export function inFolders(path: string, folders: readonly string[]): boolean {
  if (folders.length === 0) return false;
  const clean = path.normalize("NFC");
  return folders.some((folder) => clean === folder || clean.startsWith(`${folder}/`));
}

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
