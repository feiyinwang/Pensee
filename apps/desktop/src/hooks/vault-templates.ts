import { useCallback, useSyncExternalStore } from "react";
import {
  CORE_TEMPLATES_SETTINGS,
  TEMPLATER_SETTINGS,
  folderTemplates,
  isProjectTemplate,
  templateFolder,
  type FolderTemplate,
} from "@/lib/project-template";
import * as tauri from "@/lib/tauri";

// The vault's template settings, read once per vault and kept until one of
// their files changes (`forgetVaultTemplates`). In an iCloud vault every one
// of these files can be a placeholder whose first read waits on a download,
// so reading them per list, per keystroke or per new project made all three
// wait. Nothing here waits on them: the folders filter what is shown as soon
// as they're known, and the project template is asked for when Projects opens.

export interface ProjectTemplate {
  /** Vault-relative folder a new project goes in. */
  folder: string;
  /** Vault-relative path of the template note. */
  template: string;
  content: string;
}

interface Entry {
  root: string;
  /** Template folders, once read. */
  folders: string[] | null;
  foldersLoad: Promise<string[]> | null;
  projectLoad: Promise<ProjectTemplate | null> | null;
  /** Vault-relative files whose change makes this entry stale. */
  watched: Set<string>;
}

let entry: Entry | null = null;
const listeners = new Set<() => void>();
const NO_FOLDERS: string[] = [];

function entryFor(root: string): Entry {
  if (entry?.root !== root) {
    entry = {
      root,
      folders: null,
      foldersLoad: null,
      projectLoad: null,
      watched: new Set([TEMPLATER_SETTINGS, CORE_TEMPLATES_SETTINGS]),
    };
  }
  return entry;
}

/** A file's content, or null when it's missing or unreadable (logged). */
async function readOptional(root: string, file: string): Promise<string | null> {
  const path = `${root}/${file}`;
  try {
    if (!(await tauri.fileExists(path))) return null;
    return (await tauri.readFile(path)).content;
  } catch (error: unknown) {
    console.error(`[templates] reading ${file} failed`, error);
    return null;
  }
}

/** The vault-relative folders whose notes are templates: Templater's
 *  `templates_folder` and the core Templates plugin's `folder`. */
export function loadTemplateFolders(root: string): Promise<string[]> {
  const current = entryFor(root);
  if (current.foldersLoad) return current.foldersLoad;
  const load: Promise<string[]> = Promise.all([
    readOptional(root, TEMPLATER_SETTINGS).then((s) => s && templateFolder(s, "templates_folder")),
    readOptional(root, CORE_TEMPLATES_SETTINGS).then((s) => s && templateFolder(s, "folder")),
  ]).then((found) => {
    const folders = found.filter((folder) => folder !== null);
    if (entry === current && current.foldersLoad === load) {
      current.folders = folders;
      for (const listener of listeners) listener();
    }
    return folders;
  });
  current.foldersLoad = load;
  return load;
}

/** The template folders known so far: none until the first read lands. */
export function knownTemplateFolders(root: string): string[] {
  return (entry?.root === root ? entry.folders : null) ?? NO_FOLDERS;
}

/** The template folders, starting their read; re-renders when they land. */
export function useTemplateFolders(root: string | null): string[] {
  const subscribe = useCallback(
    (listener: () => void) => {
      listeners.add(listener);
      if (root) void loadTemplateFolders(root);
      return () => {
        listeners.delete(listener);
      };
    },
    [root],
  );
  return useSyncExternalStore(subscribe, () => (root ? knownTemplateFolders(root) : NO_FOLDERS));
}

/** The Templater folder template that makes project notes (its note is
 *  `Type: Project`); null when there is none. Templates named for projects
 *  are read first, so a vault of placeholders downloads one file, not all. */
export function loadProjectTemplate(root: string): Promise<ProjectTemplate | null> {
  const current = entryFor(root);
  current.projectLoad ??= (async () => {
    const settings = await readOptional(root, TEMPLATER_SETTINGS);
    if (settings === null) return null;
    const pairs = folderTemplates(settings);
    const likely = (p: FolderTemplate) => /project/i.test(`${p.folder}/${p.template}`);
    const read = async (pair: FolderTemplate): Promise<ProjectTemplate | null> => {
      current.watched.add(pair.template.normalize("NFC"));
      const content = await readOptional(root, pair.template);
      return content !== null && isProjectTemplate(content) ? { ...pair, content } : null;
    };
    for (const pair of pairs.filter(likely)) {
      const found = await read(pair);
      if (found) return found;
    }
    // None named for projects: read the rest together, first in Templater's order wins.
    const rest = await Promise.all(pairs.filter((p) => !likely(p)).map(read));
    return rest.find((found) => found !== null) ?? null;
  })();
  return current.projectLoad;
}

/** Called for every changed file: a change to a settings file or a template
 *  read here reads them again. The folders known so far stay in use until the
 *  new ones land, so templates don't flash back into the spaces meanwhile. */
export function forgetVaultTemplates(path: string): void {
  const current = entry;
  if (!current || !path.startsWith(`${current.root}/`)) return;
  if (!current.watched.has(path.slice(current.root.length + 1).normalize("NFC"))) return;
  current.foldersLoad = null;
  current.projectLoad = null;
  void loadTemplateFolders(current.root);
}

/** Drops everything read, for a vault whose settings are replaced wholesale
 *  (tests). */
export function clearVaultTemplates(): void {
  entry = null;
}
