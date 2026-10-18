import { adoptProjectNote, createProjectNote, findNoteNamed, openSpace } from "@/hooks/use-spaces";
import { getFileStem } from "@/lib/paths";
import {
  DONE,
  NO_STATUS,
  PROJECT_TYPE,
  isProjectType,
  noteType,
  projectOf,
  statusColumns,
} from "@/lib/projects";
import {
  projectsPrompt,
  projectsReply,
  selectionItems,
  type ProjectFromText,
} from "@/lib/projects-from-text";
import { organizeModel, penBusy, penConversation } from "@/lib/second-pen-agent";
import { listTypedNotes, type TypedNote } from "@/lib/tauri";
import { readPageParts } from "./linked-block-sync";
import { showEditorNotice } from "./editor-notice-store";
import { askRepeats } from "@/components/add-to-projects/repeat-store";

// Add to Projects (SPECs/add-to-projects-spec.md): the selection's items
// go to Claude on the pen's channel, which says which make which project;
// each is then added the way the board's Add project adds a name.

const OPEN_PROJECTS = {
  label: "Open Projects",
  run: () => openSpace({ kind: "space", space: "projects" }),
};

type Outcome = "added" | "already" | "declined";

/** Every project added here lands in No status: an empty `Status`, which also
 *  clears a status the template or the note had. */
const NO_STATUS_EDIT = { status: "" };

/** Add one project: the note it names when there is one, else a new note
 *  holding the writer's words, which is also what a project in Done gets
 *  (paths in `done`): a finished project is not this one. Returns the name
 *  it went under. */
async function addProject(
  project: ProjectFromText,
  done: ReadonlySet<string>,
): Promise<{ outcome: Outcome; name: string }> {
  const found = await findNoteNamed(project.name);
  if (found === null || done.has(found)) {
    const name = found === null ? project.name : await freeName(project.name);
    await createProjectNote(name, NO_STATUS_EDIT, introOf(project.items));
    return { outcome: "added", name };
  }
  if (isProjectType(noteType((await readPageParts(found)).frontmatter))) {
    return { outcome: "already", name: project.name };
  }
  const stem = getFileStem(found);
  const adopted = await adoptProjectNote(found, NO_STATUS_EDIT, (type) =>
    window.confirm(`"${stem}" is a ${type} note. Make it a project instead?`),
  );
  return { outcome: adopted ? "added" : "declined", name: project.name };
}

/** `name`, or `name 2`, `name 3`… when a note already has it: a project the
 *  writer said is new, though Claude named it as one they have. */
async function freeName(name: string): Promise<string> {
  let candidate = name;
  for (let n = 2; (await findNoteNamed(candidate)) !== null; n += 1) candidate = `${name} ${n}`;
  return candidate;
}

/** What the popup's card shows of the writer's project named `name`. */
function projectCard(notes: readonly TypedNote[], name: string) {
  const note = notes.find((n) => n.name === name);
  const project = note ? projectOf(note) : null;
  return {
    name,
    status: project?.status ?? NO_STATUS,
    columns: project ? statusColumns([project]) : [],
    excerpt: note?.excerpt?.trim() || null,
  };
}

/** A new project's opening: its one item as written, or its items as a list. */
function introOf(items: readonly string[]): string {
  return items.length === 1 ? items[0]! : items.map((item) => `- ${item}`).join("\n");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Make projects from `text`, the writer's selection, telling them how it
 *  went in the editor notice. */
export async function addToProjects(text: string): Promise<void> {
  const items = selectionItems(text);
  if (items.length === 0) return;
  if (penBusy()) {
    showEditorNotice("The pen is still writing. Try again when it's done.");
    return;
  }
  showEditorNotice("Adding to Projects…", undefined, true);
  const conversation = penConversation(organizeModel());
  let reply: string;
  let notes: TypedNote[];
  let done: ReadonlySet<string>;
  try {
    // The projects there are, so one that may be there already is asked about.
    // Projects in Done are finished: a line is never asked about as one of them.
    const all = await listTypedNotes([PROJECT_TYPE], true);
    const finished = all.filter((note) => projectOf(note).status === DONE);
    done = new Set(finished.map((note) => note.path));
    notes = all.filter((note) => !done.has(note.path));
    reply = await conversation.send(
      projectsPrompt(
        items,
        notes.map((note) => note.name),
      ),
    );
  } catch (error) {
    showEditorNotice(`Couldn't add to Projects: ${errorText(error)}`);
    return;
  } finally {
    conversation.end();
  }
  const found = projectsReply(
    reply,
    items,
    notes.map((note) => note.name),
  );
  if (!found) {
    console.error("[add-to-projects] Unreadable reply:", reply);
    showEditorNotice("Couldn't add to Projects: Claude's answer couldn't be read. Try again.");
    return;
  }
  if (found.projects.length === 0) {
    showEditorNotice("None of this takes more than two steps, so no project was made.");
    return;
  }

  // A project that may be one the writer has: they say which before anything is made.
  const repeats = found.projects.filter((project) => project.sameAs !== null);
  const answers = await askRepeats(
    repeats.map((project) => ({
      line: project.items.join(" "),
      existing: projectCard(notes, project.sameAs!),
    })),
  );
  const isNew = new Set(repeats.filter((_, k) => answers[k] === "new"));

  const added: string[] = [];
  const already: string[] = [];
  const failed: string[] = [];
  // One by one: two projects may name the same note, and the first makes it.
  for (const project of found.projects) {
    try {
      if (project.sameAs !== null && !isNew.has(project)) {
        already.push(project.sameAs);
        continue;
      }
      if (isNew.has(project)) {
        const name = await freeName(project.name);
        await createProjectNote(name, NO_STATUS_EDIT, introOf(project.items));
        added.push(name);
        continue;
      }
      const { outcome, name } = await addProject(project, done);
      if (outcome === "added") added.push(name);
      if (outcome === "already") already.push(name);
    } catch (error) {
      console.error(`[add-to-projects] Couldn't add "${project.name}":`, error);
      failed.push(project.name);
    }
  }

  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`Added ${plural(added.length, "project", "projects")}: ${added.join(", ")}.`);
  }
  if (already.length > 0) {
    parts.push(`Already in Projects: ${already.join(", ")}.`);
  }
  if (failed.length > 0) parts.push(`Couldn't add ${failed.join(", ")}.`);
  if (found.left > 0) {
    parts.push(
      found.left === 1
        ? "1 line takes two steps or fewer, so it isn't a project."
        : `${found.left} lines take two steps or fewer, so they aren't projects.`,
    );
  }
  const reached = added.length + already.length > 0;
  showEditorNotice(parts.join(" "), reached ? OPEN_PROJECTS : undefined);
}
