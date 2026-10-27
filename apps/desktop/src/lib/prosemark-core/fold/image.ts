import { Facet } from "@codemirror/state";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import { normalizeMarkdownDestination } from "@/lib/paths";
import { foldableSyntaxFacet, selectAllDecorationsOnSelectExtension } from "./core";
import { iterChildren } from "../utils";
import { resolveImageSrc } from "../imageSrc";

// Last measured widget height per markdown destination. Images decode async,
// so without a remembered height every scroll past an unloaded image inserts
// a ~1-line placeholder that later snaps to natural size and shifts the
// heightmap under the viewport (the "jumpy scroll"). The cache survives
// widget rebuilds and re-opens of the same document.
const imageHeightCache = new Map<string, number>();

/** Shared height-stability wiring for async-loading editor images (markdown
 *  images and wiki embeds): reserve the last measured height for `cacheKey`
 *  until this element (re)decodes, record the settled height, and ask the
 *  view to re-measure so its scroll anchoring compensates. `load` can fire
 *  more than once when a resolver rewrites `src` after insertion; the last
 *  one wins.
 *
 *  There used to be a `container` parameter, and it was what got measured.
 *  Deliberately gone: the number is re-applied as `image.style.height`, so
 *  anything that measures more than the image reserves space the image will
 *  never use. Harmless while every caller wrapped nothing but the picture, and
 *  wrong the moment one did not. Do not add it back "just for context" — an
 *  unused element here is an invitation to measure it again. */
export function attachStableImageHeight(
  image: HTMLImageElement,
  cacheKey: string,
  view: EditorView,
): void {
  const cached = imageHeightCache.get(cacheKey);
  if (cached !== undefined) {
    image.style.height = `${cached}px`;
  }
  image.addEventListener("load", () => {
    image.style.height = "";
    // The image, and only the image. Measured on the real case that exposed
    // this: a column whose caption sits on the line directly under the picture
    // renders as one band, and that band is a text line taller than the
    // picture — 337px cached for a 301px image, so every render reserved 36px
    // of space that never existed. That nudges the picture down relative to
    // the plain one beside it and leaves CodeMirror's height map disagreeing
    // with the DOM until the decode lands.
    const height = image.getBoundingClientRect().height;
    if (height > 0) {
      imageHeightCache.set(cacheKey, height);
    }
    view.requestMeasure();
  });
  image.addEventListener("error", () => {
    image.style.height = "";
    view.requestMeasure();
  });
}

/** Host hook for images that are more than pictures (a `.board.svg` opens an
 *  editor). Runs after the `<img>` is built; each enhancer checks `url` itself
 *  and leaves anything it does not own alone. It may return a clean-up, run
 *  when the widget's DOM is destroyed. */
export type ImageWidgetEnhancer = (
  dom: HTMLElement,
  image: HTMLImageElement,
  url: string,
  view: EditorView,
) => void | (() => void);

/** Each widget DOM's enhancer clean-ups. */
const cleanups = new WeakMap<HTMLElement, (() => void)[]>();

export const imageWidgetEnhancerFacet = Facet.define<ImageWidgetEnhancer>();

class ImageWidget extends WidgetType {
  constructor(
    public url: string,
    public block?: boolean,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return this.url === other.url && this.block === other.block;
  }

  get estimatedHeight(): number {
    return imageHeightCache.get(this.url) ?? -1;
  }

  toDOM(view: EditorView) {
    const elem = document.createElement(this.block ? "div" : "span");
    elem.className = "cm-image";
    if (this.block) {
      elem.className += " cm-image-block";
    }
    const image = document.createElement("img");
    attachStableImageHeight(image, this.url, view);
    image.src = resolveImageSrc(view.state, this.url);
    elem.appendChild(image);
    const done: (() => void)[] = [];
    for (const enhance of view.state.facet(imageWidgetEnhancerFacet)) {
      const cleanup = enhance(elem, image, this.url, view);
      if (cleanup) done.push(cleanup);
    }
    if (done.length) cleanups.set(elem, done);
    return elem;
  }

  destroy(dom: HTMLElement) {
    for (const cleanup of cleanups.get(dom) ?? []) cleanup();
    cleanups.delete(dom);
  }

  // allows clicks to pass through to the editor
  ignoreEvent(_event: Event) {
    return false;
  }
}

export const imageExtension = [
  foldableSyntaxFacet.of({
    nodePath: "Image",
    keepDecorationOnUnfold: true,
    buildDecorations: (state, node, selectionTouchesRange) => {
      let imageUrl: string | undefined;
      iterChildren(node.node.cursor(), (node) => {
        if (node.name === "URL") {
          imageUrl = normalizeMarkdownDestination(state.doc.sliceString(node.from, node.to));
        }

        return undefined;
      });

      if (imageUrl) {
        const line = state.doc.lineAt(node.from);
        const block = node.from == line.from && node.to == line.to;
        const widget = new ImageWidget(imageUrl, block);

        if (selectionTouchesRange) {
          return Decoration.widget({
            widget,
            block,
          }).range(node.to, node.to);
        } else {
          return Decoration.replace({
            widget,
            block,
          }).range(node.from, node.to);
        }
      }
    },
  }),
  selectAllDecorationsOnSelectExtension("cm-image"),
];

export const __testImage = {
  imageHeightCache,
};
