import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/arc/badge/badge";
import { KanbanBoard, type KanbanCard } from "@/components/arc/blocks/kanban-board/kanban-board";
import { SortableDataTable } from "@/components/arc/sortable-data-table/sortable-data-table";
import { ensureArcTokens } from "@/components/editor-area/board/arc-tokens";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { editPage } from "@/components/editor-area/linked-block-sync";
import { navigateToFile, openLinkedPage } from "@/hooks/editor-api";
import {
  adoptProjectNote,
  createProjectNote,
  findNoteNamed,
  searchNotes,
  type TypedNote,
} from "@/hooks/use-spaces";
import { loadProjectTemplate } from "@/hooks/vault-templates";
import { useWorkspaceRoot } from "@/hooks/use-workspace";
import { getFileStem } from "@/lib/paths";
import type { SearchResult } from "@/types/fs";
import {
  NO_STATUS,
  PROJECT_TYPE,
  dayToDate,
  formatDay,
  projectOf,
  statusColumns,
  deadlineTag,
  statusLabel,
  statusTone,
  statusValue,
  today,
  withProjectEdit,
  type Day,
  type Project,
  type ProjectEdit,
  type StatusColumn,
  type TagTone,
  TONE_COLOR,
} from "@/lib/projects";
import { formatRelativeTime } from "@/lib/relative-time";
import type { SpaceView } from "@/lib/spaces";
import { noteTitle } from "./space-cover";
import styles from "./project-views.module.css";

/** Project views (SPECs/project-views-spec.md): one set of projects shown as a
 *  list, a kanban or a timeline. Edits write the project note's frontmatter. */
export default function ProjectViews({ notes, view }: { notes: TypedNote[]; view: SpaceView }) {
  ensureArcTokens();
  // Read the project template now, so a new project doesn't wait on it (in an
  // iCloud vault its first read can take seconds).
  const root = useWorkspaceRoot();
  useEffect(() => {
    if (root) void loadProjectTemplate(root);
  }, [root]);
  const { projects, columns, edit, add } = useProjects(notes);
  return (
    <div className={styles.projectViews}>
      {view === "kanban" ? (
        <Kanban projects={projects} columns={columns} edit={edit} add={add} />
      ) : view === "timeline" ? (
        <Timeline projects={projects} columns={columns} edit={edit} add={add} />
      ) : (
        <ProjectList projects={projects} columns={columns} add={add} />
      )}
    </div>
  );
}

/** What a view changes: a status column id, or days. */
interface Change {
  status?: string;
  start?: Day;
  deadline?: Day;
}

type EditProject = (project: Project, change: Change) => void;

/** Adds a project where `change` puts it: the note picked, or the note a
 *  typed name names, else a new project note. Rejects with a message fit to
 *  show when the name is empty or the write fails. */
type AddProject = (choice: AddChoice, change: Change) => Promise<void>;

/** What the add field picked: a note suggested while typing, or the name as typed. */
type AddChoice = { path: string } | { name: string };

interface Pending {
  change: Change;
  /** Writes started and not yet finished. */
  writing: number;
  /** The note's mtime when the last write started: once the note is re-read
   *  with a newer one, the file holds the change and this entry is spent. */
  modifiedAt: number;
}

// Writes to one note go one after another, so a quick second move reads the
// first one's result instead of racing it.
const writeQueue = new Map<string, Promise<void>>();

function queueWrite(path: string, write: () => Promise<void>): Promise<void> {
  const next = (writeQueue.get(path) ?? Promise.resolve()).then(write, write);
  writeQueue.set(path, next);
  void next.finally(() => {
    if (writeQueue.get(path) === next) writeQueue.delete(path);
  });
  return next;
}

/** Projects with any change still being written shown in place, so a moved
 *  card or bar doesn't jump back until the file is re-read. A project created
 *  here shows first until the re-read notes include it. */
function useProjects(notes: TypedNote[]) {
  const [pending, setPending] = useState<ReadonlyMap<string, Pending>>(new Map());
  const [created, setCreated] = useState<readonly Project[]>([]);

  const base = useMemo(() => {
    const read = notes.map(projectOf);
    if (created.length === 0) return read;
    const paths = new Set(notes.map((note) => note.path));
    return [...created.filter((p) => !paths.has(p.note.path)), ...read];
  }, [notes, created]);
  const columns = useMemo(() => statusColumns(base), [base]);

  const projects = useMemo(
    () =>
      base.map((project) => {
        const entry = pending.get(project.note.path);
        if (!entry || isSpent(entry, project.note)) return project;
        return { ...project, ...entry.change };
      }),
    [base, pending],
  );

  // Drop spent entries once the re-read notes arrive.
  useEffect(() => {
    const byPath = new Map(notes.map((note) => [note.path, note]));
    setPending((current) => {
      let next: Map<string, Pending> | null = null;
      for (const [path, entry] of current) {
        const note = byPath.get(path);
        if (note && !isSpent(entry, note)) continue;
        next ??= new Map(current);
        next.delete(path);
      }
      return next ?? current;
    });
    const paths = new Set(notes.map((note) => note.path));
    setCreated((current) =>
      current.some((p) => paths.has(p.note.path))
        ? current.filter((p) => !paths.has(p.note.path))
        : current,
    );
  }, [notes]);

  // A status column id becomes the column's name, as the note stores it.
  const toEdit = useCallback(
    (change: Change): ProjectEdit => {
      const column =
        change.status === undefined ? undefined : columns.find((c) => c.id === change.status);
      return {
        status: column ? statusValue(column) : undefined,
        start: change.start,
        deadline: change.deadline,
      };
    },
    [columns],
  );

  const edit = useCallback<EditProject>(
    (project, change) => {
      const path = project.note.path;
      const projectEdit = toEdit(change);
      setPending((current) => {
        const next = new Map(current);
        const entry = current.get(path);
        next.set(path, {
          change: { ...entry?.change, ...change },
          writing: (entry?.writing ?? 0) + 1,
          modifiedAt: project.note.modified_at,
        });
        return next;
      });
      const settle = (failed: boolean) =>
        setPending((current) => {
          const entry = current.get(path);
          if (!entry) return current;
          const next = new Map(current);
          if (failed) next.delete(path);
          else next.set(path, { ...entry, writing: entry.writing - 1 });
          return next;
        });
      void queueWrite(path, () =>
        editPage(path, (page) => ({
          ...page,
          frontmatter: withProjectEdit(page.frontmatter, projectEdit),
        })),
      ).then(
        () => settle(false),
        (error: unknown) => {
          settle(true);
          console.error("[projects] edit failed", path, error);
          window.alert(
            `Couldn't update ${noteTitle(project.note)}: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      );
    },
    [toEdit],
  );

  /** Shows a project added here at once, until the re-read notes include it. */
  const show = useCallback((path: string, change: Change) => {
    const stem = getFileStem(path);
    const project: Project = {
      note: {
        path,
        relative_path: `${stem}.md`,
        name: stem,
        title: null,
        note_type: PROJECT_TYPE,
        modified_at: 0,
        properties: {},
        excerpt: null,
      },
      status: change.status ?? NO_STATUS,
      start: change.start ?? null,
      deadline: change.deadline ?? null,
    };
    setCreated((current) => [project, ...current]);
  }, []);

  // A note that exists is used, never duplicated: a project already here
  // moves to where it was added, any other note becomes a project (asking
  // first when it has another type). A typed name takes the note it names;
  // only a name no note has writes a new project note, from the vault's
  // template, with No status unless the place sets one (the template's own
  // status would put it anywhere).
  const add = useCallback<AddProject>(
    async (choice, change) => {
      let found: string | null;
      if ("path" in choice) {
        found = choice.path;
      } else {
        const projectPaths = new Set(base.map((project) => project.note.path));
        found = await findNoteNamed(choice.name, (path) => projectPaths.has(path));
        if (found === null) {
          const created = { status: NO_STATUS, ...change };
          const { path } = await createProjectNote(choice.name, toEdit(created));
          show(path, created);
          return;
        }
      }
      const known = base.find((project) => project.note.path === found);
      if (known) {
        if (Object.keys(change).length > 0) edit(known, change);
        return;
      }
      const stem = getFileStem(found);
      const adopted = await adoptProjectNote(found, toEdit(change), (type) =>
        window.confirm(`"${stem}" is a ${type} note. Make it a project instead?`),
      );
      if (adopted) show(found, change);
    },
    [toEdit, base, edit, show],
  );

  return { projects, columns, edit, add };
}

function isSpent(entry: Pending, note: TypedNote): boolean {
  return entry.writing === 0 && note.modified_at !== entry.modifiedAt;
}

/** Opens a project's note; with Cmd held, beside the current page. */
function openNote(event: { metaKey: boolean; ctrlKey: boolean }, path: string) {
  const open = event.metaKey || event.ctrlKey ? openLinkedPage : navigateToFile;
  void open(path).catch((error: unknown) => {
    window.alert(`Failed to open: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/** "+ New project", then the add field. */
function NewProject(props: Omit<AddFieldProps, "onClose">) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className={styles.newButton} onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.8} aria-hidden />
        New project
      </button>
    );
  }
  return <AddField {...props} onClose={() => setOpen(false)} />;
}

/** Notes suggested under the add field. */
const MAX_SUGGESTIONS = 6;

interface AddFieldProps {
  projects: Project[];
  columns: StatusColumn[];
  /** Adds what was picked; rejects with a message to show under the field. */
  onAdd: (choice: AddChoice) => Promise<void>;
  onClose: () => void;
}

interface NoteOption {
  kind: "note";
  path: string;
  stem: string;
  /** Vault-relative folder; empty at the root. */
  folder: string;
}

type Option = NoteOption | { kind: "new" };

/** The name field every "Add project" opens. Typing lists the notes with a
 *  matching name: one already on the board shows its status, any other its
 *  folder. Enter takes the note named exactly that, else creates the project;
 *  arrows or a click pick another. The field stays open for the next one; Esc,
 *  or leaving it while empty, closes it. */
function AddField({ projects, columns, onAdd, onClose }: AddFieldProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);
  const [results, setResults] = useState<{ query: string; notes: SearchResult[] }>({
    query: "",
    notes: [],
  });
  // The highlighted row, kept only for the list it was moved in: a new list
  // starts on its first row, the exact name or Create.
  const [cursor, setCursor] = useState<{ list: Option[]; index: number } | null>(null);
  const busy = useRef(false);
  const listId = useId();

  const query = name.trim();
  useEffect(() => {
    if (!query) return;
    let live = true;
    searchNotes(query, 30).then(
      (found) => {
        if (live) setResults({ query, notes: found });
      },
      (reason: unknown) => console.error("[projects] note search failed", reason),
    );
    return () => {
      live = false;
    };
  }, [query]);

  const statusByPath = useMemo(
    () => new Map(projects.map((project) => [project.note.path, project.status])),
    [projects],
  );
  const options = useMemo<Option[]>(() => {
    if (!query) return [];
    // Results for an older query would offer notes the name no longer matches.
    const notes = results.query === query ? results.notes : [];
    const named = notes.map<NoteOption>((r) => {
      const slash = r.relative_path.lastIndexOf("/");
      return {
        kind: "note",
        path: r.path,
        stem: getFileStem(r.filename),
        folder: slash === -1 ? "" : r.relative_path.slice(0, slash),
      };
    });
    // The note named exactly this comes first (one on the board, then the
    // shortest path, as findNoteNamed picks); without one, creating it does.
    const wanted = query.toLowerCase();
    const exact = named
      .filter((o) => o.stem.toLowerCase() === wanted)
      .sort(
        (a, b) =>
          Number(statusByPath.has(b.path)) - Number(statusByPath.has(a.path)) ||
          a.path.length - b.path.length,
      )[0];
    const rest = named.filter((o) => o !== exact).slice(0, MAX_SUGGESTIONS - 1);
    return exact ? [exact, ...rest] : [{ kind: "new" }, ...rest];
  }, [query, results, statusByPath]);
  const active = cursor?.list === options ? cursor.index : 0;

  const close = () => {
    setName("");
    setError(null);
    onClose();
  };

  const pick = (option: Option | undefined) => {
    if (busy.current || !query) return;
    busy.current = true;
    const choice: AddChoice = option?.kind === "note" ? { path: option.path } : { name: query };
    onAdd(choice)
      .then(
        () => {
          setName("");
          setError(null);
        },
        (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => (busy.current = false));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setCursor({ list: options, index: (active + step + options.length) % options.length });
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(options[active]);
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;
  const showList = focused && options.length > 0;
  return (
    <div className={styles.newForm}>
      <input
        className={styles.newInput}
        value={name}
        placeholder="Project name"
        aria-label="New project name"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? optionId(active) : undefined}
        aria-invalid={error !== null}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the field opens because the user asked to type a name
        autoFocus
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (!query && !busy.current) close();
        }}
      />
      {showList && (
        <div id={listId} role="listbox" aria-label="Projects to add" className={styles.suggestions}>
          {options.map((option, i) => (
            <div
              key={option.kind === "note" ? option.path : "new"}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={styles.suggestion}
              // Keeps focus in the field, so the list stays and the next name can follow.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setCursor({ list: options, index: i })}
              onClick={() => pick(option)}
            >
              {option.kind === "new" ? (
                <>
                  <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.8} aria-hidden />
                  <span className={styles.suggestionName}>
                    Create “<strong>{query}</strong>”
                  </span>
                </>
              ) : (
                <>
                  <span className={styles.suggestionName}>{option.stem}</span>
                  {statusByPath.has(option.path) ? (
                    <StatusTag status={statusByPath.get(option.path)!} columns={columns} />
                  ) : (
                    option.folder && (
                      <span className={styles.suggestionFolder}>{option.folder}</span>
                    )
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {error && (
        <div role="alert" className={styles.newError}>
          {error}
        </div>
      )}
    </div>
  );
}

/* List ------------------------------------------------------------------ */

interface ListRow extends Record<string, unknown> {
  path: string;
  name: string;
  /** The column's place on the board, so sorting by status follows the board. */
  status: number;
  start: Day | null;
  deadline: Day | null;
  edited: number;
}

/** Fixed widths for the short columns, sized for their longest value ("Overdue ·
 *  Dec 20, 2023", "143 weeks ago") so nothing wraps. Arc's table would lock
 *  them as percentages, which squeeze in a narrow column; below the sum plus
 *  the name's minimum the table scrolls inside its card (Arc's rule). */
const LIST_WIDTHS = { status: 116, start: 124, deadline: 204, edited: 136 };

function ProjectList({
  projects,
  columns,
  add,
}: {
  projects: Project[];
  columns: StatusColumn[];
  add: AddProject;
}) {
  const byPath = useMemo(() => new Map(projects.map((p) => [p.note.path, p])), [projects]);
  const rows = useMemo<ListRow[]>(
    () =>
      projects.map((project) => ({
        path: project.note.path,
        name: noteTitle(project.note),
        status: columns.findIndex((c) => c.id === project.status),
        start: project.start,
        deadline: project.deadline,
        edited: project.note.modified_at,
      })),
    [projects, columns],
  );
  const day = (value: unknown) => (typeof value === "number" ? formatDay(value) : "");
  const now = today();
  return (
    <>
      <SortableDataTable<ListRow>
        rows={rows}
        rowKey="path"
        caption="Projects"
        defaultSort={{ key: "edited", direction: "desc" }}
        columns={[
          {
            // Takes the room the fixed columns leave.
            key: "name",
            label: "Name",
            render: (_, row) => (
              <button
                type="button"
                className={styles.rowName}
                onClick={(event) => openNote(event, row.path)}
              >
                {row.name}
              </button>
            ),
          },
          {
            key: "status",
            label: "Status",
            numeric: false,
            width: LIST_WIDTHS.status,
            render: (_, row) => (
              <StatusTag status={byPath.get(row.path)!.status} columns={columns} />
            ),
          },
          { key: "start", label: "Start", numeric: false, width: LIST_WIDTHS.start, render: day },
          {
            key: "deadline",
            label: "Deadline",
            numeric: false,
            width: LIST_WIDTHS.deadline,
            render: (_, row) => <DeadlineTag project={byPath.get(row.path)!} now={now} />,
          },
          {
            key: "edited",
            label: "Last edited",
            numeric: false,
            width: LIST_WIDTHS.edited,
            render: (value) => formatRelativeTime(value as number) ?? "",
          },
        ]}
      />
      <div className={styles.listNew}>
        <NewProject projects={projects} columns={columns} onAdd={(choice) => add(choice, {})} />
      </div>
    </>
  );
}

/** A tag: Arc's badge as a neutral pill, its meaning in a coloured dot. */
function Tag({ tone, children }: { tone: TagTone; children: string }) {
  return (
    <Badge size="sm" className={styles.tag} style={{ "--tag": TONE_COLOR[tone] } as CSSProperties}>
      {children}
    </Badge>
  );
}

function StatusTag({ status, columns }: { status: string; columns: StatusColumn[] }) {
  const tone = statusTone(status);
  if (tone === null) return <span className={styles.noStatus}>No status</span>;
  return <Tag tone={tone}>{statusLabel(columns, status)}</Tag>;
}

function DeadlineTag({ project, now }: { project: Project; now: Day }) {
  const tag = deadlineTag(project, now);
  return tag ? <Tag tone={tag.tone}>{tag.label}</Tag> : null;
}

/* Kanban ---------------------------------------------------------------- */

/** Arc's kanban block over the projects: a card per project, a column per
 *  status. Moving a card writes its Status; "Add project" makes a note. The
 *  order inside a column has no field in the note, so it lasts this session. */
function Kanban({
  projects,
  columns,
  edit,
  add,
}: {
  projects: Project[];
  columns: StatusColumn[];
  edit: EditProject;
  add: AddProject;
}) {
  const [order, setOrder] = useState<readonly string[]>([]);
  const now = today();

  // Opens with Ongoing in the middle when the board is wider than the page.
  // Arc's block is vendored (docs/arc.md), so this finds its column and scroller.
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const cell = host.current?.querySelector<HTMLElement>('[data-cell="ongoing"]');
    let scroller = cell?.parentElement;
    while (scroller && scroller !== host.current && getComputedStyle(scroller).overflowX !== "auto")
      scroller = scroller.parentElement;
    if (!cell || !scroller || scroller === host.current) return;
    const c = cell.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    scroller.scrollLeft += c.left + c.width / 2 - (s.left + s.width / 2);
  }, []);

  const byPath = useMemo(() => new Map(projects.map((p) => [p.note.path, p])), [projects]);
  const cards = useMemo<KanbanCard[]>(() => {
    const rank = new Map(order.map((path, i) => [path, i]));
    // Projects not placed by hand yet (new, or never moved) keep the newest-edit order, first.
    const sorted = [...projects].sort(
      (a, b) => (rank.get(a.note.path) ?? -1) - (rank.get(b.note.path) ?? -1),
    );
    return sorted.map((project) => ({
      id: project.note.path,
      title: noteTitle(project.note),
      column: project.status,
      assignee: "",
      meta: project.deadline === null ? undefined : <DeadlineTag project={project} now={now} />,
    }));
  }, [projects, order, now]);

  const onCardsChange = (next: KanbanCard[]) => {
    for (const card of next) {
      const project = byPath.get(card.id);
      if (project && project.status !== card.column) edit(project, { status: card.column });
    }
    setOrder(next.filter((card) => byPath.has(card.id)).map((card) => card.id));
  };

  return (
    <div ref={host} className={styles.boardHost}>
      <KanbanBoard
        className={styles.board}
        columns={columns.map((column) => {
          const tone = statusTone(column.id);
          return {
            id: column.id,
            name: column.label,
            label: tone ? <Tag tone={tone}>{column.label}</Tag> : column.label,
          };
        })}
        people={[]}
        currentUser=""
        cards={cards}
        onCardsChange={onCardsChange}
        onCardOpen={(card, event) => openNote(event, card.id)}
        toolbar={false}
        showIds={false}
        noun="project"
        composer={(column, close) => (
          <AddField
            projects={projects}
            columns={columns}
            onAdd={(choice) => add(choice, { status: column })}
            onClose={close}
          />
        )}
      />
    </div>
  );
}

/* Timeline -------------------------------------------------------------- */

const DAY_PX = 3;
/** Pointer travel before a press on a bar becomes a drag. */
const DRAG_THRESHOLD_PX = 4;
const MIN_BAR_PX = 20;
/** Grab width of a bar's ends. */
const HANDLE_PX = 6;

type BarPart = "move" | "start" | "end";

interface BarDrag {
  path: string;
  start: Day | null;
  deadline: Day | null;
}

/** First day of the month `day` falls in. */
function monthStart(day: Day): Day {
  const date = dayToDate(day);
  return Math.round(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 86_400_000);
}

function addMonths(day: Day, months: number): Day {
  const date = dayToDate(day);
  return Math.round(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()) / 86_400_000,
  );
}

const monthFormat = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" });

/** The days a project's bar covers; one date alone is a one-day bar. */
function span(project: { start: Day | null; deadline: Day | null }): [Day, Day] | null {
  const { start, deadline } = project;
  if (start === null && deadline === null) return null;
  const a = start ?? deadline!;
  const b = deadline ?? start!;
  return a <= b ? [a, b] : [b, a];
}

/** The dates a drag of `part` by `delta` days gives `project`. Only dates the
 *  project has move, except an end handle, which sets the date it stands for. */
function dragged(project: Project, part: BarPart, delta: number): BarDrag {
  const [from, to] = span(project)!;
  const result: BarDrag = {
    path: project.note.path,
    start: project.start,
    deadline: project.deadline,
  };
  if (part === "move") {
    if (result.start !== null) result.start += delta;
    if (result.deadline !== null) result.deadline += delta;
  } else if (part === "start") {
    result.start = Math.min(from + delta, project.deadline ?? Infinity);
  } else {
    result.deadline = Math.max(to + delta, project.start ?? -Infinity);
  }
  return result;
}

function changeOf(project: Project, next: BarDrag): Change {
  const change: Change = {};
  if (next.start !== null && next.start !== project.start) change.start = next.start;
  if (next.deadline !== null && next.deadline !== project.deadline) change.deadline = next.deadline;
  return change;
}

function Timeline({
  projects,
  columns,
  edit,
  add,
}: {
  projects: Project[];
  columns: StatusColumn[];
  edit: EditProject;
  add: AddProject;
}) {
  const now = today();
  const scroller = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<BarDrag | null>(null);
  const [view, setView] = useState<{ left: number; width: number }>({ left: 0, width: 0 });
  const justDragged = useRef(false);
  const [focusPath, setFocusPath] = useState<string | null>(null);

  // Done projects stay on the board and the list, not on the timeline.
  const open = useMemo(() => projects.filter((p) => p.status !== "done"), [projects]);
  const shown = useMemo(
    () =>
      open.map((project) =>
        preview?.path === project.note.path ? { ...project, ...preview } : project,
      ),
    [open, preview],
  );
  const dated = useMemo(
    () =>
      shown
        .filter((p) => span(p) !== null)
        .sort(
          (a, b) => span(a)![0] - span(b)![0] || noteTitle(a.note).localeCompare(noteTitle(b.note)),
        ),
    [shown],
  );
  const undated = useMemo(() => shown.filter((p) => span(p) === null), [shown]);

  // The range stays put while a bar is dragged, so the grid doesn't slide under it.
  const rangeProjects = preview ? open : shown;
  const [rangeStart, rangeEnd] = useMemo(() => {
    let min = now;
    let max = now;
    for (const project of rangeProjects) {
      const s = span(project);
      if (!s) continue;
      min = Math.min(min, s[0]);
      max = Math.max(max, s[1]);
    }
    return [monthStart(addMonths(min, -1)), monthStart(addMonths(max, 3))];
  }, [rangeProjects, now]);

  const months = useMemo(() => {
    const list: { day: Day; label: string; year: number; january: boolean }[] = [];
    for (let day = rangeStart; day < rangeEnd; day = addMonths(day, 1)) {
      const date = dayToDate(day);
      list.push({
        day,
        label: monthFormat.format(date),
        year: date.getUTCFullYear(),
        january: date.getUTCMonth() === 0,
      });
    }
    return list;
  }, [rangeStart, rangeEnd]);

  const x = (day: Day) => (day - rangeStart) * DAY_PX;
  const trackWidth = x(rangeEnd);

  const trackLeft = useCallback(() => {
    const node = scroller.current;
    const name = node?.querySelector<HTMLElement>("[data-name-cell]");
    return name?.offsetWidth ?? 0;
  }, []);

  const scrollToDay = useCallback(
    (day: Day, behavior: ScrollBehavior) => {
      const node = scroller.current;
      if (!node) return;
      const visible = node.clientWidth - trackLeft();
      node.scrollTo({ left: Math.max(0, (day - rangeStart) * DAY_PX - visible / 3), behavior });
    },
    [rangeStart, trackLeft],
  );

  // Opens on today.
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (opened.current) return;
    opened.current = true;
    scrollToDay(now, "auto");
  }, [now, scrollToDay]);

  // Which days are in view, for the arrows that point at bars off screen.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setView({ left: node.scrollLeft, width: node.clientWidth - trackLeft() });
    };
    measure();
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [trackLeft]);

  useLayoutEffect(() => {
    if (!focusPath) return;
    scroller.current
      ?.querySelector<HTMLElement>(`[data-bar="${CSS.escape(focusPath)}"]`)
      ?.focus({ preventScroll: true });
    setFocusPath(null);
  }, [focusPath, projects]);

  const onBarPointerDown = (event: ReactPointerEvent<HTMLElement>, project: Project) => {
    if (event.button !== 0) return;
    const bar = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - bar.left;
    const part: BarPart =
      offset < HANDLE_PX ? "start" : offset > bar.width - HANDLE_PX ? "end" : "move";
    const startX = event.clientX;
    let moved = false;
    let last: BarDrag | null = null;

    const onMove = (e: PointerEvent) => {
      if (!moved && Math.abs(e.clientX - startX) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const next = dragged(project, part, Math.round((e.clientX - startX) / DAY_PX));
      if (last && next.start === last.start && next.deadline === last.deadline) return;
      last = next;
      setPreview(next);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      if (!moved) return;
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      setPreview(null);
      if (!commit || !last) return;
      const change = changeOf(project, last);
      if (Object.keys(change).length > 0) edit(project, change);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || !moved) return;
      e.preventDefault();
      finish(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  };

  const onBarKeyDown = (event: KeyboardEvent<HTMLElement>, project: Project) => {
    if (event.key === "Enter") {
      event.preventDefault();
      openNote(event, project.note.path);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -1 : 1;
    const change = changeOf(project, dragged(project, event.shiftKey ? "end" : "move", delta));
    if (Object.keys(change).length === 0) return;
    edit(project, change);
    setFocusPath(project.note.path);
  };

  const onTrackClick = (event: MouseEvent<HTMLDivElement>, project: Project) => {
    const rect = event.currentTarget.getBoundingClientRect();
    edit(project, { start: rangeStart + Math.floor((event.clientX - rect.left) / DAY_PX) });
  };

  const viewStart = rangeStart + Math.floor(view.left / DAY_PX);
  const viewEnd = rangeStart + Math.floor((view.left + view.width) / DAY_PX);
  const firstMonthInView =
    monthStart(viewStart) === viewStart ? viewStart : addMonths(monthStart(viewStart), 1);

  const nameCell = (project: Project) => (
    <button
      type="button"
      data-name-cell=""
      className={styles.nameCell}
      onClick={(event) => openNote(event, project.note.path)}
    >
      <span className={styles.name}>{noteTitle(project.note)}</span>
    </button>
  );

  return (
    <div className={styles.timeline} ref={scroller}>
      <div
        className={styles.timelineInner}
        style={{ width: `calc(var(--name-width) + ${trackWidth}px)` }}
      >
        <div className={styles.timelineHeader}>
          <div className={styles.corner} data-name-cell="">
            <button
              type="button"
              className={styles.todayButton}
              onClick={() => scrollToDay(now, "smooth")}
            >
              Today
            </button>
          </div>
          <div className={styles.months} style={{ width: trackWidth }}>
            {months.map((month) => (
              <span key={month.day} className={styles.month} style={{ left: x(month.day) }}>
                {/* The year shows on January and on the first month label in view. */}
                {month.january || month.day === firstMonthInView
                  ? `${month.label} ${month.year}`
                  : month.label}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.rows}>
          <div className={styles.grid} style={{ width: trackWidth }} aria-hidden>
            {months.map((month) => (
              <span key={month.day} className={styles.gridLine} style={{ left: x(month.day) }} />
            ))}
            <span className={styles.todayLine} style={{ left: x(now) + DAY_PX / 2 }} />
          </div>

          {dated.map((project) => {
            const [from, to] = span(project)!;
            const left = x(from);
            const width = Math.max((to - from + 1) * DAY_PX, MIN_BAR_PX);
            const before = to < viewStart;
            const after = from > viewEnd;
            return (
              <div key={project.note.path} className={styles.row}>
                {nameCell(project)}
                <div className={styles.track} style={{ width: trackWidth }}>
                  <div
                    role="button"
                    tabIndex={0}
                    data-bar={project.note.path}
                    data-dragging={preview?.path === project.note.path ? "" : undefined}
                    className={styles.bar}
                    style={
                      {
                        left,
                        width,
                        "--tag": TONE_COLOR[statusTone(project.status) ?? "gray"],
                      } as CSSProperties
                    }
                    aria-label={`${noteTitle(project.note)}, ${datesLabel(project)}`}
                    onPointerDown={(event) => onBarPointerDown(event, project)}
                    onClick={(event) => {
                      if (!justDragged.current) openNote(event, project.note.path);
                    }}
                    onKeyDown={(event) => onBarKeyDown(event, project)}
                  >
                    <span className={styles.handle} data-side="start" />
                    <span className={styles.handle} data-side="end" />
                  </div>
                  <span className={styles.barDates} style={{ left: left + width + 8 }}>
                    {datesLabel(project)}
                    {alarm(project, now)}
                  </span>
                  {(before || after) && (
                    <button
                      type="button"
                      className={styles.offscreen}
                      data-side={before ? "start" : "end"}
                      style={
                        before ? { left: view.left + 6 } : { left: view.left + view.width - 6 }
                      }
                      onClick={() => scrollToDay(from, "smooth")}
                    >
                      {before ? `← ${formatDay(to)}` : `${formatDay(from)} →`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {undated.length > 0 && (
            <>
              <div className={styles.groupRow}>
                <span className={styles.groupLabel} data-name-cell="">
                  No dates
                  <span className={styles.groupCount}>{undated.length}</span>
                </span>
              </div>
              {undated.map((project) => (
                <div key={project.note.path} className={styles.row}>
                  {nameCell(project)}
                  <div
                    className={styles.track}
                    data-empty=""
                    style={{ width: trackWidth }}
                    title="Click to start it on this day"
                    onClick={(event) => onTrackClick(event, project)}
                  />
                </div>
              ))}
            </>
          )}

          <div className={styles.newRow}>
            <div className={styles.newCell}>
              <NewProject
                projects={projects}
                columns={columns}
                onAdd={(choice) => add(choice, { start: now })}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The deadline tag beside a bar, only when it asks for attention. */
function alarm(project: Project, now: Day) {
  const tag = deadlineTag(project, now);
  return tag && tag.tone !== "gray" ? <Tag tone={tag.tone}>{tag.label}</Tag> : null;
}

function datesLabel(project: Project): string {
  const { start, deadline } = project;
  if (start !== null && deadline !== null) return `${formatDay(start)} – ${formatDay(deadline)}`;
  if (start !== null) return `Starts ${formatDay(start)}`;
  return `Due ${formatDay(deadline!)}`;
}
