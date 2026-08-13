import type { EditorView } from "@codemirror/view";
import type { BlockTypeId } from "./markdown-formatting";
import {
  acceptsBlockType,
  applyBlockType,
  canInsert,
  canMove,
  columnBlockCount,
  copyTarget,
  currentBlockType,
  cutTarget,
  deleteTarget,
  duplicateTarget,
  insertBlock,
  moveTarget,
  type ActionTarget,
} from "./block-actions";
import "./block-handle-menu.css";

/**
 * The panel that opens when the pointer rests on the gutter handle.
 *
 * ## Why this is DOM and not a native menu
 *
 * Every other menu in the app is a Tauri `Menu`. This one cannot be. A native
 * menu has no way to draw a grid of type tiles, and — the part that actually
 * decides it — showing one blocks the JavaScript event loop until it closes,
 * so "opens on hover, closes when the pointer leaves" has no thread to run on.
 *
 * ## Why it lives on `document.body`
 *
 * Not in `contentDOM`: CodeMirror's DOM observer reads anything that appears
 * there as an edit. Not in `view.dom` either — the editor scrolls and clips,
 * and a panel anchored to a handle needs to escape both. Body plus
 * `position: fixed` is the same place the drag lift goes.
 *
 * ## The one geometry rule
 *
 * Height comes from content. Never from a ratio of the width — that mistake
 * has already been made once in this editor and it clipped the text inside a
 * floating panel at some window sizes.
 */

/* --------------------------------------------------------------------- icons */

/** Hand-drawn strokes rather than an icon import: this panel is plain DOM
 *  built inside a CodeMirror plugin, with no React to render a component
 *  into, and `currentColor` keeps `color` as the single knob so one glyph can
 *  be muted grey in a row and red in the delete row. */
function svg(body: string): string {
  return (
    `<svg class="wr-bmenu-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    body +
    `</svg>`
  );
}

const ICON = {
  up: svg(`<path d="M10 15.5V4.5"/><path d="M5.5 9 10 4.5 14.5 9"/>`),
  down: svg(`<path d="M10 4.5v11"/><path d="M5.5 11 10 15.5 14.5 11"/>`),
  left: svg(`<path d="M15.5 10h-11"/><path d="M9 5.5 4.5 10 9 14.5"/>`),
  right: svg(`<path d="M4.5 10h11"/><path d="M11 5.5 15.5 10 11 14.5"/>`),
  insertAbove: svg(`<path d="M3.5 4h13"/><path d="M10 8v7"/><path d="M6.5 11.5h7"/>`),
  insertBelow: svg(`<path d="M3.5 16h13"/><path d="M10 5v7"/><path d="M6.5 8.5h7"/>`),
  duplicate: svg(
    `<rect x="3.5" y="3.5" width="9" height="9" rx="2"/>` +
      `<path d="M7.5 16.5h7a2 2 0 0 0 2-2v-7"/>`,
  ),
  copy: svg(
    `<rect x="7" y="7" width="9.5" height="9.5" rx="2"/>` +
      `<path d="M12.5 4H5.5a1.5 1.5 0 0 0-1.5 1.5v7"/>`,
  ),
  cut: svg(
    `<circle cx="5.5" cy="14.5" r="2"/><circle cx="14.5" cy="14.5" r="2"/>` +
      `<path d="M6.8 13 14 3.5"/><path d="M13.2 13 6 3.5"/>`,
  ),
  trash: svg(
    `<path d="M3.8 5.5h12.4"/><path d="M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/>` +
      `<path d="M5.5 5.5 6.2 16a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9l.7-10.5"/>`,
  ),
  caret: svg(`<path d="M8 5.5 12.5 10 8 14.5"/>`),
} as const;

/* ---------------------------------------------------------------- type tiles */

interface Tile {
  id: BlockTypeId;
  label: string;
  /** Typographic tiles read better than drawn ones for the heading levels —
   *  "H2" *is* the icon. Only the two list shapes need strokes. */
  glyph: string;
  className?: string;
}

const LIST_ROWS = (marks: string) =>
  svg(`<path d="M8.5 5.5h8"/><path d="M8.5 10h8"/><path d="M8.5 14.5h8"/>${marks}`);

const TILES: readonly Tile[] = [
  { id: "text", label: "Text", glyph: "T", className: "wr-bmenu-glyph-serif" },
  { id: "h1", label: "Heading 1", glyph: "H1" },
  { id: "h2", label: "Heading 2", glyph: "H2" },
  { id: "h3", label: "Heading 3", glyph: "H3" },
  {
    id: "numbered",
    label: "Numbered list",
    glyph: LIST_ROWS(
      `<text x="3.4" y="7.4" font-size="5.4" fill="currentColor" stroke="none">1</text>` +
        `<text x="3.4" y="11.9" font-size="5.4" fill="currentColor" stroke="none">2</text>` +
        `<text x="3.4" y="16.4" font-size="5.4" fill="currentColor" stroke="none">3</text>`,
    ),
  },
  {
    id: "bullet",
    label: "Bulleted list",
    glyph: LIST_ROWS(
      `<circle cx="4.6" cy="5.5" r="1.1" fill="currentColor" stroke="none"/>` +
        `<circle cx="4.6" cy="10" r="1.1" fill="currentColor" stroke="none"/>` +
        `<circle cx="4.6" cy="14.5" r="1.1" fill="currentColor" stroke="none"/>`,
    ),
  },
  {
    id: "task",
    label: "To-do list",
    glyph: svg(
      `<rect x="3.5" y="3.5" width="13" height="13" rx="3"/><path d="M6.8 10 9 12.4 13.4 7"/>`,
    ),
  },
  { id: "code", label: "Code block", glyph: "{ }", className: "wr-bmenu-glyph-mono" },
  { id: "quote", label: "Quote", glyph: "”", className: "wr-bmenu-glyph-quote" },
];

/* --------------------------------------------------------------------- model */

interface Row {
  label: string;
  icon: string;
  danger?: boolean;
  /** Kept for the submenus that do not exist yet (alignment, colour). Nothing
   *  sets it today, so `group()` renders the caret for nobody. */
  submenu?: boolean;
  run?: () => void;
}

/** Milliseconds the pointer has to rest on the handle before this opens.
 *  Not optional: the handle slides down the left margin under the pointer, so
 *  a hand crossing a column of paragraphs passes over a dozen of them. */
export const MENU_OPEN_DELAY = 220;

/** Grace period after the pointer leaves both the handle and the panel.
 *  The gap between them is bridged in CSS, not here. */
export const MENU_CLOSE_DELAY = 150;

export class BlockHandleMenu {
  /** Public because the gutter plugin has to hang its own hover listeners on
   *  it — the pointer travelling grip → panel must not start the close timer,
   *  and only the plugin knows about that corridor. */
  readonly root: HTMLElement;
  private target: ActionTarget | null = null;
  private open = false;
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly onWindowBlur: () => void;
  private readonly onScroll: () => void;

  constructor(private readonly view: EditorView) {
    this.root = document.createElement("div");
    this.root.className = "wr-bmenu";
    this.root.setAttribute("role", "menu");
    this.root.hidden = true;
    // Focus must never leave the editor. If it did, a band that is open for
    // editing would commit and rebuild its widget mid-click, and the action
    // would run against a target that no longer exists.
    this.root.addEventListener("mousedown", (e) => e.preventDefault());
    document.body.append(this.root);

    this.onKey = (e) => {
      if (e.key === "Escape" && this.open) {
        e.preventDefault();
        this.close();
      }
    };
    this.onWindowBlur = () => this.close();
    this.onScroll = () => this.close();
  }

  isOpen(): boolean {
    return this.open;
  }

  openFor(target: ActionTarget, anchor: DOMRect): void {
    this.target = target;
    this.root.replaceChildren(...this.build(target));
    if (!this.root.childElementCount) return this.close();

    this.root.hidden = false;
    if (!this.open) {
      this.open = true;
      window.addEventListener("keydown", this.onKey, true);
      window.addEventListener("blur", this.onWindowBlur);
      this.view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    }
    this.root.classList.add("wr-bmenu-on");
    this.position(anchor);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.target = null;
    this.root.hidden = true;
    this.root.classList.remove("wr-bmenu-on");
    this.root.replaceChildren();
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("blur", this.onWindowBlur);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
  }

  destroy(): void {
    this.close();
    this.root.remove();
  }

  /* ------------------------------------------------------------- positioning */

  /** Two axes, two jobs — and they must not be the same axis.
   *
   *  This used to open *below* the handle and share its left edge: avoidance on
   *  the vertical, straight overlap on the horizontal. But the vertical is also
   *  the axis that has to absorb "there is no room left in the window", so the
   *  moment a tall panel near the bottom of the screen got clamped upward it
   *  landed on top of the handle that opened it. It looked like an h1 bug —
   *  an h1's handle sits low and its panel is tall — but any block low enough
   *  in the viewport did it.
   *
   *  So the horizontal is what keeps them apart, and it is never clamped; the
   *  vertical is clamped freely and cannot produce an overlap wherever it ends
   *  up. Do not put an "if it doesn't fit, flip to the left" branch back in:
   *  that hands the invariant back to a conditional and the bug returns. */
  private position(anchor: DOMRect): void {
    // Measured, never derived: the panel's height is whatever its rows add up
    // to. Never a ratio of the width — that mistake has been made here before.
    const box = this.root.getBoundingClientRect();
    const margin = 8;
    const gap = 8;

    // Vertical: flush with the top of the handle, then clamped into view.
    let top = anchor.top;
    if (top + box.height > window.innerHeight - margin) {
      top = window.innerHeight - margin - box.height;
    }
    top = Math.max(margin, top);

    // Horizontal: the invariant. Always right of the handle, and it does not
    // slide back to avoid covering text — text can be read again afterwards,
    // whereas a hidden handle leaves you unable to tell which block the menu is
    // about to act on. The only escape is a window too narrow to hold the panel
    // at all, which is under ~300px and not a size anyone writes at.
    let left = anchor.right + gap;
    if (left + box.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - box.width);
    }

    this.root.style.top = `${Math.round(top)}px`;
    this.root.style.left = `${Math.round(left)}px`;
  }

  /* ------------------------------------------------------------------ render */

  private act(run: () => boolean): void {
    const target = this.target;
    if (!target) return;
    // Close first. The action dispatches, CodeMirror rebuilds, and anything
    // this panel is holding on to would be pointing at freed DOM.
    this.close();
    run();
    this.view.focus();
  }

  private build(target: ActionTarget): HTMLElement[] {
    const out: HTMLElement[] = [];
    const view = this.view;

    if (acceptsBlockType(view, target)) {
      const active = currentBlockType(view, target);
      out.push(this.grid(active, (id) => this.act(() => applyBlockType(view, target, id))));
    }

    const moves: Row[] = [];
    const sideways = target.kind === "col";
    if (canMove(view, target, -1)) {
      moves.push({
        label: sideways ? "Move left" : "Move up",
        icon: sideways ? ICON.left : ICON.up,
        run: () => this.act(() => moveTarget(view, target, -1)),
      });
    }
    if (canMove(view, target, 1)) {
      moves.push({
        label: sideways ? "Move right" : "Move down",
        icon: sideways ? ICON.right : ICON.down,
        run: () => this.act(() => moveTarget(view, target, 1)),
      });
    }
    if (canInsert(target)) {
      moves.push({
        label: "Insert above",
        icon: ICON.insertAbove,
        run: () => this.act(() => insertBlock(view, target, "above")),
      });
      moves.push({
        label: "Insert below",
        icon: ICON.insertBelow,
        run: () => this.act(() => insertBlock(view, target, "below")),
      });
    }
    if (moves.length) out.push(this.group(moves));

    // No "Align and Indent" / "Color Options" placeholders. They were here as
    // greyed-out rows holding the slot for the day markdown has somewhere to
    // store alignment and colour, but the cost of a permanently dead row is
    // paid at every single open and the benefit waits on a decision that has
    // not been made. When there is a storage format, add the group back — it
    // is one array entry.

    out.push(
      this.group([
        {
          label: "Duplicate",
          icon: ICON.duplicate,
          run: () => this.act(() => duplicateTarget(view, target)),
        },
        { label: "Cut", icon: ICON.cut, run: () => this.act(() => cutTarget(view, target)) },
        { label: "Copy", icon: ICON.copy, run: () => this.act(() => copyTarget(view, target)) },
        {
          label: target.kind === "col" ? "Delete column" : "Delete",
          icon: ICON.trash,
          danger: true,
          run: () =>
            // One block is one undo away, so a confirmation there costs more
            // than the mistake. A column takes several blocks at once, and
            // what went missing is not visible on screen afterwards.
            target.kind === "col"
              ? this.confirmColumnDelete(target)
              : this.act(() => deleteTarget(view, target)),
        },
      ]),
    );

    return out;
  }

  private grid(active: BlockTypeId | null, pick: (id: BlockTypeId) => void): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "wr-bmenu-grid";
    for (const tile of TILES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wr-bmenu-tile";
      button.setAttribute("role", "menuitem");
      if (tile.className) button.classList.add(tile.className);
      button.title = tile.label;
      button.setAttribute("aria-label", tile.label);
      if (tile.id === active) button.dataset.active = "true";
      button.innerHTML = tile.glyph;
      button.addEventListener("click", () => pick(tile.id));
      grid.append(button);
    }
    return grid;
  }

  private group(rows: Row[]): HTMLElement {
    const group = document.createElement("div");
    group.className = "wr-bmenu-group";
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wr-bmenu-row";
      button.setAttribute("role", "menuitem");
      if (row.danger) button.classList.add("wr-bmenu-danger");
      const icon = document.createElement("span");
      icon.className = "wr-bmenu-lead";
      icon.innerHTML = row.icon;
      const label = document.createElement("span");
      label.className = "wr-bmenu-label";
      label.textContent = row.label;
      button.append(icon, label);
      if (row.submenu) {
        const caret = document.createElement("span");
        caret.className = "wr-bmenu-trail";
        caret.innerHTML = ICON.caret;
        button.append(caret);
      }
      if (row.run) button.addEventListener("click", row.run);
      group.append(button);
    }
    return group;
  }

  /** Swap the panel's contents for the question rather than opening a dialog:
   *  a native `confirm()` would take the event loop with it, and the panel is
   *  already the thing under the pointer. */
  private confirmColumnDelete(target: ActionTarget): void {
    const count = columnBlockCount(this.view, target);
    const box = document.createElement("div");
    box.className = "wr-bmenu-confirm";

    const text = document.createElement("p");
    text.textContent = `Delete this column and its ${count} ${count === 1 ? "block" : "blocks"}?`;

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "wr-bmenu-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.close());

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "wr-bmenu-btn wr-bmenu-btn-danger";
    confirm.textContent = "Delete";
    confirm.addEventListener("click", () => this.act(() => deleteTarget(this.view, target)));

    const actions = document.createElement("div");
    actions.className = "wr-bmenu-confirm-actions";
    actions.append(cancel, confirm);
    box.append(text, actions);
    this.root.replaceChildren(box);
  }
}
