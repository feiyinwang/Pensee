import { adoptProjectNote, createProjectNote, findNoteNamed, openSpace } from "@/hooks/use-spaces";
import { getFileStem } from "@/lib/paths";
import { isProjectType, noteType } from "@/lib/projects";
import {
  projectsPrompt,
  projectsReply,
  selectionSentences,
  type ProjectFromText,
} from "@/lib/projects-from-text";
import { organizeModel, penBusy, penConversation } from "@/lib/second-pen-agent";
import { readPageParts } from "./linked-block-sync";
import { showEditorNotice } from "./editor-notice-store";

// Add to Projects (SPECs/add-to-projects-spec.md): the selection's sentences
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
 *  holding the writer's sentences. */
async function addProject(project: ProjectFromText): Promise<Outcome> {
  const found = await findNoteNamed(project.name);
  if (found === null) {
    await createProjectNote(project.name, NO_STATUS_EDIT, project.sentences.join(" "));
    return "added";
  }
  if (isProjectType(noteType((await readPageParts(found)).frontmatter))) return "already";
  const stem = getFileStem(found);
  const adopted = await adoptProjectNote(found, NO_STATUS_EDIT, (type) =>
    window.confirm(`"${stem}" is a ${type} note. Make it a project instead?`),
  );
  return adopted ? "added" : "declined";
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
  const sentences = selectionSentences(text);
  if (sentences.length === 0) return;
  if (penBusy()) {
    showEditorNotice("The pen is still writing. Try again when it's done.");
    return;
  }
  showEditorNotice("Adding to Projects…", undefined, true);
  const conversation = penConversation(organizeModel());
  let reply: string;
  try {
    reply = await conversation.send(projectsPrompt(sentences));
  } catch (error) {
    showEditorNotice(`Couldn't add to Projects: ${errorText(error)}`);
    return;
  } finally {
    conversation.end();
  }
  const found = projectsReply(reply, sentences);
  if (!found) {
    console.error("[add-to-projects] Unreadable reply:", reply);
    showEditorNotice("Couldn't add to Projects: Claude's answer couldn't be read. Try again.");
    return;
  }
  if (found.projects.length === 0) {
    showEditorNotice("None of this takes more than two steps, so no project was made.");
    return;
  }

  const added: string[] = [];
  const already: string[] = [];
  const failed: string[] = [];
  // One by one: two projects may name the same note, and the first makes it.
  for (const project of found.projects) {
    try {
      const outcome = await addProject(project);
      if (outcome === "added") added.push(project.name);
      if (outcome === "already") already.push(project.name);
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
        ? "1 sentence takes two steps or fewer, so it isn't a project."
        : `${found.left} sentences take two steps or fewer, so they aren't projects.`,
    );
  }
  const reached = added.length + already.length > 0;
  showEditorNotice(parts.join(" "), reached ? OPEN_PROJECTS : undefined);
}
