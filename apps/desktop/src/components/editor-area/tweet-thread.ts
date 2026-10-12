import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  BlockType,
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";

import spaceStyles from "@/components/spaces/spaces.module.css";
import { getOpenFile, subscribeOpenFiles } from "@/hooks/editor-api";
import { formatDay, parseDay } from "@/lib/projects";
import { tweetAvatar } from "@/lib/spaces";
import { type TweetNoteProps, tweetNoteProps } from "@/lib/x-bookmarks";
import { showEditorNotice } from "./editor-notice-store";
import "./tweet-thread.css";

// The thread view of an X bookmark note (SPECs/x-bookmarks-spec.md,
// "Reading"). Only for `Type: Tweet` notes, and drawn entirely from
// decorations: the file stays the plain markdown `bookmarkNote` wrote.
//
// - An author header from the properties, as a block widget above the body.
// - Every line of the thread is indented (`cm-tweet-line`), and a measured
//   overlay in `view.dom` draws the spine, a dot per post and the post numbers
//   in that indent, the way `heading-level-labels.ts` draws in the margin.
//   The overlay follows the layout model, so a block widget inside a post (a
//   link card) or a `---` shown as source never breaks the line.
// - The `---` between posts keeps its own fold (`fold/horizontalRule.ts`), so
//   the caret still reveals the source; CSS only hides its rule inside the
//   thread.
// - A quoted post's blockquote lines are drawn as one bordered card.
//
// The thread is the body up to its `Posts`-th `---` (or the first heading).
// The properties live in the editor store, not the document, so the field
// re-reads them when the document is swapped or the store's copy changes.

/** Where a note's thread sits in its body. */
export interface ThreadLayout {
  /** The start of each post's first line, in order. */
  posts: number[];
  /** The start of the first post's first line. */
  from: number;
  /** The end of the last post's last block. */
  to: number;
  quotes: { from: number; to: number }[];
}

const HEADING_RE = /^(?:ATXHeading|SetextHeading)/;

/** The thread in `state`'s body: top-level blocks split into posts at each
 *  `---`, ending at the `count`-th `---` or the first heading. Null when the
 *  body has no post. */
export function threadLayout(state: EditorState, count: number | null): ThreadLayout | null {
  const posts: number[] = [];
  const quotes: ThreadLayout["quotes"] = [];
  let to = 0;
  let startsPost = true;
  const cursor = syntaxTree(state).topNode.cursor();
  if (!cursor.firstChild()) return null;
  do {
    if (HEADING_RE.test(cursor.name)) break;
    if (cursor.name === "HorizontalRule") {
      if (posts.length >= (count ?? Infinity)) break;
      startsPost = true;
      continue;
    }
    if (startsPost) {
      posts.push(state.doc.lineAt(cursor.from).from);
      startsPost = false;
    }
    if (cursor.name === "Blockquote") quotes.push({ from: cursor.from, to: cursor.to });
    to = cursor.to;
  } while (cursor.nextSibling());
  return posts.length ? { posts, from: posts[0], to, quotes } : null;
}

const X_LOGO =
  "M17.8 3h3.1l-6.8 7.7 8 10.3h-6.2l-4.9-6.3L5.4 21H2.3l7.2-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** `Oct 8`, with the year when it isn't this year's; the value as written
 *  when it isn't a date. */
function dayLabel(value: string): string {
  const day = parseDay(value);
  return day === null ? value : formatDay(day);
}

function openPost(url: string) {
  void openUrl(url).catch((error: unknown) => {
    console.error("[tweet-thread] Couldn't open the post:", error);
    showEditorNotice(
      `Couldn't open the post: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

class TweetHeaderWidget extends WidgetType {
  constructor(
    readonly props: TweetNoteProps,
    readonly fallbackName: string,
  ) {
    super();
  }

  eq(other: TweetHeaderWidget): boolean {
    const a = this.props;
    const b = other.props;
    return (
      a.author === b.author &&
      a.handle === b.handle &&
      a.url === b.url &&
      a.posted === b.posted &&
      a.saved === b.saved &&
      a.posts === b.posts &&
      this.fallbackName === other.fallbackName
    );
  }

  get estimatedHeight(): number {
    return 96;
  }

  toDOM(): HTMLElement {
    const { author, handle, url, posted, saved, posts } = this.props;
    const root = element("div", "cm-tweet-header");
    const row = element("div", "cm-tweet-author");

    const avatar = tweetAvatar(author, handle, this.fallbackName);
    const face = element(
      "span",
      `cm-tweet-avatar ${spaceStyles[`tone${avatar.tone}`] ?? ""}`,
      avatar.initial,
    );
    face.setAttribute("aria-hidden", "true");

    const who = element("div", "cm-tweet-who");
    who.append(element("div", "cm-tweet-name", avatar.name));
    const meta = [author && handle ? `@${handle}` : null, posted ? dayLabel(posted) : null];
    if (meta.some(Boolean)) {
      who.append(element("div", "cm-tweet-meta", meta.filter(Boolean).join(" · ")));
    }
    row.append(face, who);

    if (url) {
      const open = element("button", "cm-tweet-open");
      open.type = "button";
      open.title = url;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", X_LOGO);
      svg.append(path);
      open.append(svg, document.createTextNode("Open on X"));
      // Keep the editor's focus and selection; see docs/editor.md.
      open.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      open.addEventListener("click", () => openPost(url));
      row.append(open);
    }
    root.append(row);

    const facts = [
      posts && posts > 1 ? `${posts} posts` : null,
      saved ? `Bookmarked ${dayLabel(saved)}` : null,
    ].filter(Boolean);
    if (facts.length) root.append(element("div", "cm-tweet-facts", facts.join(" · ")));
    return root;
  }

  // The header is not text: a press on it never places the caret.
  ignoreEvent(): boolean {
    return true;
  }
}

const lineDeco = Decoration.line({ class: "cm-tweet-line" });
const quoteDeco = {
  only: Decoration.line({
    class: "cm-tweet-line cm-tweet-quote cm-tweet-quote-first cm-tweet-quote-last",
  }),
  first: Decoration.line({ class: "cm-tweet-line cm-tweet-quote cm-tweet-quote-first" }),
  middle: Decoration.line({ class: "cm-tweet-line cm-tweet-quote" }),
  last: Decoration.line({ class: "cm-tweet-line cm-tweet-quote cm-tweet-quote-last" }),
};

function threadDecorations(
  state: EditorState,
  props: TweetNoteProps,
  layout: ThreadLayout | null,
  fallbackName: string,
): DecorationSet {
  const ranges: Range<Decoration>[] = [
    Decoration.widget({
      widget: new TweetHeaderWidget(props, fallbackName),
      block: true,
      side: -1,
    }).range(0),
  ];
  if (layout) {
    const { doc } = state;
    const quoteLines = new Map<number, Decoration>();
    for (const quote of layout.quotes) {
      const first = doc.lineAt(quote.from).number;
      const last = doc.lineAt(quote.to).number;
      for (let n = first; n <= last; n++) {
        quoteLines.set(
          n,
          first === last
            ? quoteDeco.only
            : n === first
              ? quoteDeco.first
              : n === last
                ? quoteDeco.last
                : quoteDeco.middle,
        );
      }
    }
    const last = doc.lineAt(layout.to).number;
    for (let n = doc.lineAt(layout.from).number; n <= last; n++) {
      ranges.push((quoteLines.get(n) ?? lineDeco).range(doc.line(n).from));
    }
  }
  return Decoration.set(ranges, true);
}

interface ThreadState {
  frontmatter: string | null;
  props: TweetNoteProps | null;
  layout: ThreadLayout | null;
  decorations: DecorationSet;
}

/** Re-read the note's properties from the editor store. */
const refreshThread = StateEffect.define<null>();

/** Where the overlay draws, in `view.dom` coordinates. */
interface SpineGeometry {
  /** The text column's left edge. */
  left: number;
  /** The middle of each post's first line. */
  dots: number[];
  bottom: number;
}

/** The top of the text line at `pos`, not of a block widget sharing its
 *  line block (the header sits on the first line's block). */
function textTop(view: EditorView, pos: number): number {
  const block = view.lineBlockAt(pos);
  if (Array.isArray(block.type)) {
    const text = block.type.find((b) => b.type === BlockType.Text && b.from <= pos && pos <= b.to);
    if (text) return text.top;
  }
  return block.top;
}

export function tweetThread(getFilePath: () => string): Extension {
  const readFrontmatter = () => getOpenFile(getFilePath())?.frontmatter ?? null;
  const fallbackName = () => {
    const path = getFilePath();
    return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  };

  const compute = (
    state: EditorState,
    frontmatter: string | null,
    prev: ThreadState | null,
  ): ThreadState => {
    const props =
      prev && prev.frontmatter === frontmatter ? prev.props : tweetNoteProps(frontmatter);
    if (!props) return { frontmatter, props, layout: null, decorations: Decoration.none };
    const layout = threadLayout(state, props.posts);
    return {
      frontmatter,
      props,
      layout,
      decorations: threadDecorations(state, props, layout, fallbackName()),
    };
  };

  const threadField = StateField.define<ThreadState>({
    create: (state) => compute(state, readFrontmatter(), null),
    update(value, tr) {
      const reread = tr.docChanged || tr.effects.some((e) => e.is(refreshThread));
      const frontmatter = reread ? readFrontmatter() : value.frontmatter;
      if (frontmatter === value.frontmatter) {
        // Not a bookmark: nothing to redo, whatever the edit (one map lookup
        // per edit in every other note).
        if (!value.props) return value;
        if (!tr.docChanged && syntaxTree(tr.startState) === syntaxTree(tr.state)) return value;
      }
      return compute(tr.state, frontmatter, value);
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });

  const spine = ViewPlugin.fromClass(
    class {
      private readonly root: HTMLDivElement;
      private readonly unsubscribe: () => void;
      private destroyed = false;
      private readonly measureReq: {
        key: object;
        read: (view: EditorView) => SpineGeometry | null;
        write: (geometry: SpineGeometry | null) => void;
      };

      constructor(readonly view: EditorView) {
        this.root = element("div", "cm-tweet-spine");
        this.root.setAttribute("aria-hidden", "true");
        view.dom.append(this.root);
        this.measureReq = { key: this, read: (v) => this.read(v), write: (g) => this.write(g) };
        view.requestMeasure(this.measureReq);
        // Properties edited in the panel change the store, not the document.
        // Dispatch outside the store update: it can run inside an editor
        // update (the editor mirrors its content into the store).
        this.unsubscribe = subscribeOpenFiles(() => {
          if (readFrontmatter() === view.state.field(threadField).frontmatter) return;
          queueMicrotask(() => {
            if (this.destroyed) return;
            if (readFrontmatter() === view.state.field(threadField).frontmatter) return;
            view.dispatch({ effects: refreshThread.of(null) });
          });
        });
      }

      update(update: ViewUpdate) {
        const changed = update.startState.field(threadField) !== update.state.field(threadField);
        if (!changed && !update.state.field(threadField).layout) return;
        if (
          changed ||
          update.docChanged ||
          update.viewportChanged ||
          update.geometryChanged ||
          update.heightChanged
        ) {
          update.view.requestMeasure(this.measureReq);
        }
      }

      private read(view: EditorView): SpineGeometry | null {
        const { layout } = view.state.field(threadField);
        if (!layout || layout.posts.length < 2) return null;
        const host = view.dom.getBoundingClientRect();
        const content = view.contentDOM.getBoundingClientRect();
        const padLeft = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0;
        const top = view.documentTop - host.top;
        const half = view.defaultLineHeight / 2;
        return {
          left: content.left + padLeft - host.left,
          dots: layout.posts.map((pos) => top + textTop(view, pos) + half),
          bottom: top + view.lineBlockAt(layout.to).bottom,
        };
      }

      private write(geometry: SpineGeometry | null) {
        if (!geometry) {
          this.root.replaceChildren();
          return;
        }
        const { left, dots, bottom } = geometry;
        this.root.style.left = `${left}px`;
        const line = element("div", "cm-tweet-spine-line");
        line.style.top = `${dots[0]}px`;
        line.style.height = `${Math.max(0, bottom - dots[0])}px`;
        const marks: HTMLElement[] = [line];
        dots.forEach((y, i) => {
          const dot = element("div", "cm-tweet-dot");
          dot.style.top = `${y}px`;
          marks.push(dot);
          if (i === 0) return;
          const number = element("div", "cm-tweet-number", `${i + 1}/${dots.length}`);
          number.style.top = `${y}px`;
          marks.push(number);
        });
        this.root.replaceChildren(...marks);
      }

      destroy() {
        this.destroyed = true;
        this.unsubscribe();
        this.root.remove();
      }
    },
  );

  return [threadField, spine];
}
