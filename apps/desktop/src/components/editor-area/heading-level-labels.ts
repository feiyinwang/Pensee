import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { treeChanged } from "@/lib/prosemark-core/utils";
import { GRIP_WIDTH, firstLineBox, gripTop } from "./columns-decorations";
import { getMarkdownHeadingLevel } from "./heading-decorations";
import "./heading-level-labels.css";

// An always-visible H1–H6 label in the left margin of every heading, so the
// level reads at a glance without the `#` marks (which are hidden for good —
// see `.cm-heading-hash` in prosemark-theme.css).
//
// The label sits in exactly the box the gutter grip's type chip uses: same
// left edge (`GRIP_WIDTH` in from the text column) and the same vertical
// centring on the measured first line box (`firstLineBox` + `gripTop`). When
// the grip parks on a heading it hides its own chip and adds only its dots, so
// hovering a heading reads as the label growing a handle rather than a second
// chip appearing on top of the first.
//
// The labels live in `view.dom`, beside the grip, not in the lines: they sit in
// the page padding, outside any line box, and CodeMirror's DOM observer would
// redraw over anything added inside `contentDOM`.

interface LabelSpot {
  level: number;
  top: number;
}

interface Measured {
  left: number;
  spots: LabelSpot[];
}

class HeadingLevelLabels {
  private readonly root: HTMLDivElement;
  private readonly measureReq: {
    key: HeadingLevelLabels;
    read: (view: EditorView) => Measured;
    write: (measured: Measured) => void;
  };

  constructor(readonly view: EditorView) {
    this.root = document.createElement("div");
    this.root.className = "wr-heading-levels";
    this.root.setAttribute("aria-hidden", "true");
    view.dom.append(this.root);
    this.measureReq = { key: this, read: (v) => this.read(v), write: (m) => this.write(m) };
    view.requestMeasure(this.measureReq);
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      treeChanged(update)
    ) {
      update.view.requestMeasure(this.measureReq);
    }
  }

  private read(view: EditorView): Measured {
    const host = view.dom.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const padLeft = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0;
    // Same x as the grip (`place` in columns-decorations.ts).
    const left = Math.max(0, content.left + padLeft - host.left - GRIP_WIDTH - 4);
    const spots: LabelSpot[] = [];
    const tree = syntaxTree(view.state);
    for (const { from, to } of view.visibleRanges) {
      tree.iterate({
        from,
        to,
        enter(node) {
          const level = getMarkdownHeadingLevel(node.name);
          if (level === null) return undefined;
          const lineFrom = view.state.doc.lineAt(node.from).from;
          const dom = view.domAtPos(lineFrom).node;
          // Inside a replaced range (a column row, say) there is no line to
          // stand beside, and nothing to label.
          const lineEl = (
            dom instanceof HTMLElement ? dom : dom.parentElement
          )?.closest<HTMLElement>(".cm-line");
          if (lineEl && view.contentDOM.contains(lineEl)) {
            spots.push({ level, top: gripTop(firstLineBox(lineEl), host.top) });
          }
          return false;
        },
      });
    }
    return { left, spots };
  }

  private write({ left, spots }: Measured) {
    const labels = this.root.children;
    spots.forEach((spot, i) => {
      let label = labels[i] as HTMLElement | undefined;
      if (!label) {
        label = document.createElement("span");
        label.className = "wr-heading-level";
        this.root.append(label);
      }
      const text = `H${spot.level}`;
      if (label.textContent !== text) label.textContent = text;
      label.style.left = `${left}px`;
      label.style.top = `${spot.top}px`;
    });
    while (labels.length > spots.length) labels[labels.length - 1].remove();
  }

  destroy() {
    this.root.remove();
  }
}

export const headingLevelLabels = ViewPlugin.fromClass(HeadingLevelLabels);
