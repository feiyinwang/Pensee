# Page preview on link hover

## Ask

Hovering a page link such as `[[主场]]` shows a preview of that page, and the preview can be scrolled to read it.

## Behaviour

- Hovering a rendered wiki link for 350ms opens a card under the link (above it when there is more room there), 440px wide and at most 380px tall, clamped to the window.
- The card shows the page's name (click it to open the page) and the page's text in a **read-only editor** with the page editor's live-markdown rendering, so it looks like the page itself: headings, lists, emphasis, code, pictures, and wiki links (clicking one opens that page). Frontmatter is left out.
- The body scrolls inside the card; `overscroll-behavior: contain` keeps the page behind from scrolling when the preview reaches its end.
- The card stays open while the pointer is on the link or the card, with a 200ms grace to travel between them. It closes when the pointer leaves both, on Esc, on a click or a key press in the editor, and when the page behind scrolls (the link it points at would move away).
- Text comes from the page's open tab when it has one (unsaved edits included), else from disk.
- A link to a page that does not exist shows "No page yet. Click the link to create it." Hovering never creates a page.
- Motion: enters by growing out of the link (`--motion-base`, `--ease-out`, scale 0.97 → 1 and opacity), exits faster (`--motion-fast`). None of it under `prefers-reduced-motion`.

## Implementation

`apps/desktop/src/components/editor-area/wiki-link-preview.ts` (+ `.css`): a view plugin on the page editor. The card is appended to `document.body` with `position: fixed`, so the editor's scroll mask does not clip it, and it uses the shared `.surface-card` glass surface. The preview editor is a trimmed extension set (markdown, hide/fold, lists, code fences, heading decorations, image and wiki-link resolution, read-only), created per card and destroyed with it.
