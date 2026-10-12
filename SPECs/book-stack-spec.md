# Books as a stack of hardcovers

Status: Done (2026-10-12)

## Why

Books in Library were flat 2:3 cards with a 7px gradient for a spine. The user wanted them to feel like physical books, after Stripe Press's book pages: a stack of hardcovers lying flat, each showing its spine, its thickness and its hard edges.

## What

A book gallery (Library → Books, and any space you add with `Shows: Book`) shows the books as a stack, one under another down the page, instead of a grid of covers. Other cover kinds keep their grids.

Each book is a CSS 3D block (`book-stack.tsx`, `book-stack.module.css`):

- **Spine** facing you: author in italic serif on the left, title in serif centred, `Publisher:` small caps on the right when present. The title keeps its width; author and publisher truncate first. The full title is the button's tooltip.
- **Top board**, the front cover lying face up, seen from just above. Each book has its own camera (`perspective: 8000px`, origin 480px above the spine), so every book in a long list shows the same ~23px sliver instead of lower books showing more.
- **Hardcover cues:** a light lip where the board meets the spine, shade into the bottom edge, highlight along the upper middle (a rounded spine), a faint cloth weave, and a hard light edge on the board's front.
- **Colour:** the same title-hash tone pairs as the other default covers (`toneClass` in `space-cover.tsx`). With a `Cover:` image, the image lies on the board (turned so the book's head is on the left, like the spine text) and wraps onto the spine with white text over a 25% shade. An image that fails to load falls back to the tone.

Shape comes from the note (`lib/books.ts`), so a book keeps it wherever it sits:

| | From | Range |
|---|---|---|
| Thickness | `Pages:` (`24 + pages / 16`), else the title hash | 34–64px |
| Length | title hash | 560–624px, capped at the page width |

## Interaction

- Click opens the note; Cmd-click opens it beside the current page (same `openNote` as the grid).
- Hover lifts the book 5px and softens its shadow: 160ms (`--motion-base`), `--ease-out`, fine pointers only. No motion under `prefers-reduced-motion`.
- Focus ring on the spine (`--accent`, 3px offset).

## Performance

Books use `content-visibility: auto`, so off-screen books skip paint. The book's box leaves 32px above (board sliver plus the hover lift), 16px below (shadow) and 6px each side (focus ring) so nothing is clipped by the paint containment that sets.

## Not done

- Covers from the book file itself (EPUB cover, PDF first page, as the book card in a note does) are not read for the stack; only `Cover:` is.
- Text printed on the default board (the old three cover layouts) was dropped: at this angle it reads as noise.
