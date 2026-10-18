import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { KanbanBoard, type KanbanCard } from "@/components/arc/blocks/kanban-board/kanban-board";
import { ensureArcTokens } from "@/components/editor-area/board/arc-tokens";
import { Add01Icon, ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
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
  DONE,
  NO_STATUS,
  PROJECT_TYPE,
  projectOf,
  statusColumns,
  deadlineTag,
  statusTone,
  statusValue,
  today,
  withProjectEdit,
  type Day,
  type Project,
  type ProjectEdit,
  type StatusColumn,
} from "@/lib/projects";
import { noteTitle } from "./space-cover";
import styles from "./project-views.module.css";
import { StatusTag, Tag } from "./project-tag";

/** Project views (SPECs/project-views-spec.md): the projects as a kanban, a
 *  column per status. Edits write the project note's frontmatter. */
export default function ProjectViews({ notes }: { notes: TypedNote[] }) {
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
      <Kanban projects={projects} columns={columns} edit={edit} add={add} />
    </div>
  );
}

/** What the board changes: a status column id. */
interface Change {
  status?: string;
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
 *  card doesn't jump back until the file is re-read. A project created here
 *  shows first until the re-read notes include it. */
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
      return { status: column ? statusValue(column) : undefined };
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
      start: null,
      deadline: null,
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

function DeadlineTag({ project, now }: { project: Project; now: Day }) {
  const tag = deadlineTag(project, now);
  return tag ? <Tag tone={tag.tone}>{tag.label}</Tag> : null;
}

/* Kanban ---------------------------------------------------------------- */

/** Room kept under the last done card that shows: the fold toggle and the
 *  column's add row. */
const FOLD_RESERVE_PX = 96;

/** The element that scrolls Arc's board around `cell`. Arc's block is
 *  vendored (docs/arc.md), so this walks up to it instead of a ref. */
function scrollerOf(cell: HTMLElement, host: HTMLElement): HTMLElement | null {
  let node = cell.parentElement;
  while (node && node !== host && getComputedStyle(node).overflowY !== "auto")
    node = node.parentElement;
  return node === host ? null : node;
}

/** Arc's kanban block over the projects: a card per project, a column per
 *  status. Moving a card writes its Status; "Add project" makes a note. The
 *  order inside a column has no field in the note, so it lasts this session.
 *  Done shows as many cards as fit in one screen of the board; the rest fold
 *  behind "Show N more". */
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
  const [doneOpen, setDoneOpen] = useState(false);
  // Done cards that fit in one screen of the board; null while measuring,
  // which renders them all for one pass before paint.
  const [doneFit, setDoneFit] = useState<number | null>(null);
  const now = today();
  const host = useRef<HTMLDivElement>(null);

  const byPath = useMemo(() => new Map(projects.map((p) => [p.note.path, p])), [projects]);
  const sorted = useMemo(() => {
    const rank = new Map(order.map((path, i) => [path, i]));
    // Projects not placed by hand yet (new, or never moved) keep the newest-edit order, first.
    return [...projects].sort(
      (a, b) => (rank.get(a.note.path) ?? -1) - (rank.get(b.note.path) ?? -1),
    );
  }, [projects, order]);
  const done = useMemo(
    () => sorted.filter((p) => p.status === DONE).map((p) => p.note.path),
    [sorted],
  );
  const doneShown = doneOpen || doneFit === null ? done.length : Math.min(doneFit, done.length);
  const doneHidden = useMemo(() => new Set(done.slice(doneShown)), [done, doneShown]);

  const cards = useMemo<KanbanCard[]>(
    () =>
      sorted
        .filter((project) => !doneHidden.has(project.note.path))
        .map((project) => ({
          id: project.note.path,
          title: noteTitle(project.note),
          column: project.status,
          assignee: "",
          meta: project.deadline === null ? undefined : <DeadlineTag project={project} now={now} />,
        })),
    [sorted, doneHidden, now],
  );

  // Opens with Ongoing in the middle when the board is wider than the page.
  useLayoutEffect(() => {
    const cell = host.current?.querySelector<HTMLElement>('[data-cell="ongoing"]');
    const scroller = cell && scrollerOf(cell, host.current!);
    if (!cell || !scroller) return;
    const c = cell.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    scroller.scrollLeft += c.left + c.width / 2 - (s.left + s.width / 2);
  }, []);

  // Measure again when the done cards change.
  const doneKey = done.join("\n");
  useLayoutEffect(() => setDoneFit(null), [doneKey]);

  // With every done card rendered, count the ones whose bottom sits within
  // one screen of the board, leaving room for the toggle under them.
  const measuredSize = useRef({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (doneFit !== null) return;
    const cell = host.current?.querySelector<HTMLElement>(`[data-cell="${DONE}"]`);
    const scroller = cell && scrollerOf(cell, host.current!);
    if (!cell || !scroller) {
      console.error("[projects] kanban: no Done column to measure; showing every done card");
      setDoneFit(Number.POSITIVE_INFINITY);
      return;
    }
    measuredSize.current = { width: scroller.clientWidth, height: scroller.clientHeight };
    const top = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const floor = scroller.clientHeight - FOLD_RESERVE_PX;
    let fit = 0;
    for (const card of cell.querySelectorAll<HTMLElement>("[data-card-id]")) {
      if (card.getBoundingClientRect().bottom - top > floor) break;
      fit += 1;
    }
    setDoneFit(Math.max(1, fit));
  }, [doneFit]);

  // A pinch to one tab, a new column split or a window resize changes what
  // fits; measure again once the board's size really changes.
  useEffect(() => {
    const cell = host.current?.querySelector<HTMLElement>(`[data-cell="${DONE}"]`);
    const scroller = cell && scrollerOf(cell, host.current!);
    if (!scroller) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = measuredSize.current;
      if (scroller.clientWidth === width && scroller.clientHeight === height) return;
      setDoneFit(null);
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const onCardsChange = (next: KanbanCard[]) => {
    for (const card of next) {
      const project = byPath.get(card.id);
      if (project && project.status !== card.column) edit(project, { status: card.column });
    }
    // Folded done cards aren't on the board; they keep their place at Done's end.
    setOrder([...next.filter((card) => byPath.has(card.id)).map((card) => card.id), ...doneHidden]);
  };

  const foldable = doneFit !== null && done.length > doneFit;
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
            hidden: column.id === DONE ? doneHidden.size : undefined,
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
        cellFooter={(column) =>
          column === DONE && foldable ? (
            <button
              type="button"
              className={styles.foldToggle}
              aria-expanded={doneOpen}
              onClick={() => setDoneOpen((open) => !open)}
            >
              <HugeiconsIcon
                icon={doneOpen ? ArrowUp01Icon : ArrowDown01Icon}
                size={14}
                strokeWidth={1.8}
                aria-hidden
              />
              {doneOpen ? "Show fewer" : `Show ${doneHidden.size} more`}
            </button>
          ) : null
        }
      />
    </div>
  );
}
