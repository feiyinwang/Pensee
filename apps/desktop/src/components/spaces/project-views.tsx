import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { editPage } from "@/components/editor-area/linked-block-sync";
import { navigateToFile, openLinkedPage } from "@/hooks/editor-api";
import { createProjectNote, type TypedNote } from "@/hooks/use-spaces";
import {
  NO_STATUS,
  PROJECT_TYPE,
  dayToDate,
  formatDay,
  projectOf,
  statusColumns,
  statusLabel,
  statusValue,
  today,
  withProjectEdit,
  type Day,
  type Project,
  type ProjectEdit,
  type StatusColumn,
} from "@/lib/projects";
import { formatRelativeTime } from "@/lib/relative-time";
import type { SpaceView } from "@/lib/spaces";
import { noteTitle } from "./space-cover";
import spaceStyles from "./spaces.module.css";
import styles from "./project-views.module.css";

/** Project views (SPECs/project-views-spec.md): one set of projects shown as a
 *  list, a kanban or a timeline. Edits write the project note's frontmatter. */
export function ProjectViews({ notes, view }: { notes: TypedNote[]; view: SpaceView }) {
  const { projects, columns, edit, create } = useProjects(notes);
  if (view === "kanban")
    return <Kanban projects={projects} columns={columns} edit={edit} create={create} />;
  if (view === "timeline") return <Timeline projects={projects} edit={edit} create={create} />;
  return <ProjectList projects={projects} columns={columns} />;
}

/** What a view changes: a status column id, or days. */
interface Change {
  status?: string;
  start?: Day;
  deadline?: Day;
}

type EditProject = (project: Project, change: Change) => void;

/** Writes `<name>.md` as a project with `change` set; rejects with a message
 *  fit to show when the name is empty or taken. */
type CreateProject = (name: string, change: Change) => Promise<void>;

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

  const create = useCallback<CreateProject>(
    async (name, change) => {
      const { path, stem } = await createProjectNote(name, toEdit(change));
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
    },
    [toEdit],
  );

  return { projects, columns, edit, create };
}

function isSpent(entry: Pending, note: TypedNote): boolean {
  return entry.writing === 0 && note.modified_at !== entry.modifiedAt;
}

function openNote(event: MouseEvent | KeyboardEvent, path: string) {
  const open = event.metaKey || event.ctrlKey ? openLinkedPage : navigateToFile;
  void open(path).catch((error: unknown) => {
    window.alert(`Failed to open: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/** "+ New project", then a name field: Enter creates the project and keeps the
 *  field open for the next one, Esc (or leaving it empty) closes it. */
function NewProject({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const close = () => {
    setOpen(false);
    setName("");
    setError(null);
  };

  if (!open) {
    return (
      <button type="button" className={styles.newButton} onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.8} aria-hidden />
        New project
      </button>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    onCreate(name)
      .then(
        () => {
          setName("");
          setError(null);
        },
        (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => (busy.current = false));
  };

  return (
    <form className={styles.newForm} onSubmit={submit}>
      <input
        className={styles.newInput}
        value={name}
        placeholder="Project name"
        aria-label="New project name"
        aria-invalid={error !== null}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the field opens because the user asked to type a name
        autoFocus
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          close();
        }}
        onBlur={() => {
          if (!name.trim() && !busy.current) close();
        }}
      />
      {error && (
        <div role="alert" className={styles.newError}>
          {error}
        </div>
      )}
    </form>
  );
}

/* List ------------------------------------------------------------------ */

function ProjectList({ projects, columns }: { projects: Project[]; columns: StatusColumn[] }) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, path: string) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    openNote(event, path);
  };
  return (
    <table className={spaceStyles.list}>
      <colgroup>
        <col style={{ width: "40%" }} />
        <col style={{ width: "15%" }} />
        <col style={{ width: "15%" }} />
        <col style={{ width: "15%" }} />
        <col style={{ width: "15%" }} />
      </colgroup>
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Start</th>
          <th>Deadline</th>
          <th>Last edited</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((project) => (
          <tr
            key={project.note.path}
            tabIndex={0}
            onClick={(event) => openNote(event, project.note.path)}
            onKeyDown={(event) => onKeyDown(event, project.note.path)}
          >
            <td>{noteTitle(project.note)}</td>
            <td>
              <StatusPill status={project.status} columns={columns} />
            </td>
            <td>{project.start === null ? "" : formatDay(project.start)}</td>
            <td>{project.deadline === null ? "" : formatDay(project.deadline)}</td>
            <td>{formatRelativeTime(project.note.modified_at) ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusPill({ status, columns }: { status: string; columns: StatusColumn[] }) {
  return status === NO_STATUS ? (
    <span className={spaceStyles.status} data-empty="">
      No status
    </span>
  ) : (
    <span className={spaceStyles.status} data-status={status}>
      {statusLabel(columns, status)}
    </span>
  );
}

/* Kanban ---------------------------------------------------------------- */

/** Pointer travel before a press on a card becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

interface CardDrag {
  project: Project;
  /** The press point inside the card, so the card stays under the pointer. */
  offsetX: number;
  offsetY: number;
  width: number;
}

function Kanban({
  projects,
  columns,
  edit,
  create,
}: {
  projects: Project[];
  columns: StatusColumn[];
  edit: EditProject;
  create: CreateProject;
}) {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const justDragged = useRef(false);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const board = useRef<HTMLDivElement>(null);

  const byColumn = useMemo(() => {
    const map = new Map<string, Project[]>(columns.map((c) => [c.id, []]));
    for (const project of projects) map.get(project.status)?.push(project);
    return map;
  }, [projects, columns]);

  // A card moved by keyboard lands in another column's list; keep focus on it.
  useLayoutEffect(() => {
    if (!focusPath) return;
    const card = board.current?.querySelector<HTMLElement>(
      `[data-card="${CSS.escape(focusPath)}"]`,
    );
    card?.focus();
    setFocusPath(null);
  }, [focusPath, projects]);

  const move = (project: Project, columnId: string) => {
    if (columnId === project.status) return;
    edit(project, { status: columnId });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, project: Project) => {
    if (event.button !== 0) return;
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging: CardDrag | null = null;
    let over: string | null = null;

    const place = (x: number, y: number) => {
      if (!dragging || !ghost.current) return;
      ghost.current.style.transform = `translate(${x - dragging.offsetX}px, ${y - dragging.offsetY}px)`;
    };
    const columnAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest("[data-column]") as HTMLElement | null)?.dataset
        .column ?? null;

    const onMove = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
        dragging = {
          project,
          offsetX: startX - rect.left,
          offsetY: startY - rect.top,
          width: rect.width,
        };
        setDrag(dragging);
      }
      place(e.clientX, e.clientY);
      const next = columnAt(e.clientX, e.clientY);
      if (next !== over) {
        over = next;
        setTarget(next);
      }
    };
    const finish = (drop: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      if (!dragging) return;
      // The click that ends a drag must not open the note.
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      setDrag(null);
      setTarget(null);
      if (drop && over) move(project, over);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || !dragging) return;
      e.preventDefault();
      finish(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  };

  // The ghost's first frame sits where the card was, not at the corner.
  useLayoutEffect(() => {
    if (!drag || !ghost.current) return;
    const card = board.current?.querySelector<HTMLElement>(
      `[data-card="${CSS.escape(drag.project.note.path)}"]`,
    );
    const rect = card?.getBoundingClientRect();
    if (rect) ghost.current.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
  }, [drag]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, project: Project) => {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const index = columns.findIndex((c) => c.id === project.status);
    const next = columns[index + (event.key === "ArrowLeft" ? -1 : 1)];
    if (!next) return;
    move(project, next.id);
    setFocusPath(project.note.path);
  };

  return (
    <div className={styles.kanban} ref={board} data-dragging={drag ? "" : undefined}>
      {columns.map((column) => {
        const cards = byColumn.get(column.id) ?? [];
        return (
          <section
            key={column.id}
            className={styles.column}
            data-column={column.id}
            data-target={
              target === column.id && drag?.project.status !== column.id ? "" : undefined
            }
            aria-label={column.label}
          >
            <header className={styles.columnHeader}>
              <span className={styles.columnName}>{column.label}</span>
              <span className={styles.columnCount}>{cards.length}</span>
            </header>
            <div className={styles.columnCards}>
              {cards.map((project) => (
                <button
                  key={project.note.path}
                  type="button"
                  data-card={project.note.path}
                  data-lifted={drag?.project.note.path === project.note.path ? "" : undefined}
                  className={styles.card}
                  onPointerDown={(event) => onPointerDown(event, project)}
                  onClick={(event) => {
                    if (!justDragged.current) openNote(event, project.note.path);
                  }}
                  onKeyDown={(event) => onKeyDown(event, project)}
                >
                  <CardBody project={project} />
                </button>
              ))}
            </div>
            <NewProject onCreate={(name) => create(name, { status: column.id })} />
          </section>
        );
      })}
      {drag && (
        <div ref={ghost} className={styles.ghost} style={{ width: drag.width }} aria-hidden>
          <div className={styles.card}>
            <CardBody project={drag.project} />
          </div>
        </div>
      )}
    </div>
  );
}

function CardBody({ project }: { project: Project }) {
  return (
    <>
      <span className={styles.cardTitle}>{noteTitle(project.note)}</span>
      {project.deadline !== null && (
        <span className={styles.cardMeta}>Due {formatDay(project.deadline)}</span>
      )}
    </>
  );
}

/* Timeline -------------------------------------------------------------- */

const DAY_PX = 3;
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
  edit,
  create,
}: {
  projects: Project[];
  edit: EditProject;
  create: CreateProject;
}) {
  const now = today();
  const scroller = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<BarDrag | null>(null);
  const [view, setView] = useState<{ left: number; width: number }>({ left: 0, width: 0 });
  const justDragged = useRef(false);
  const [focusPath, setFocusPath] = useState<string | null>(null);

  const shown = useMemo(
    () =>
      projects.map((project) =>
        preview?.path === project.note.path ? { ...project, ...preview } : project,
      ),
    [projects, preview],
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
  const rangeProjects = preview ? projects : shown;
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
                    data-done={project.status === "done" ? "" : undefined}
                    data-dragging={preview?.path === project.note.path ? "" : undefined}
                    className={styles.bar}
                    style={{ left, width }}
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
              <NewProject onCreate={(name) => create(name, { start: now })} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function datesLabel(project: Project): string {
  const { start, deadline } = project;
  if (start !== null && deadline !== null) return `${formatDay(start)} – ${formatDay(deadline)}`;
  if (start !== null) return `Starts ${formatDay(start)}`;
  return `Due ${formatDay(deadline!)}`;
}
