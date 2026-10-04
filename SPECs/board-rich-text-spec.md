# Board text: bold, italic and truncation

## Bold and italic

Board text stays plain markdown in the file, so a `.board.svg` opened
anywhere still reads sensibly:

- `**bold**`, `*italic*` (or `_italic_` at word edges), `***both***`.
- The renderer (`parseInline` in `board-render.ts`) turns the marks into
  styled runs and draws each run as its own `<tspan>` (weight 700, or
  `font-style: italic`). Wrapping measures every run in its own face, so bold
  text wraps where it really ends.
- Marks must hug text (`2 * 3 * 4` stays literal), `_` only counts at word
  edges (`snake_case` stays literal), and unclosed marks stay literal.
- Applies to shapes, sticky notes, free text, mind-map topics and arrow
  labels.

### Keys

- **While typing** in any board text: Cmd+B / Cmd+I toggle the mark on the
  selection (or insert a pair around the caret). The field shows the marks;
  the board shows the styling once you finish typing. A selection over several
  lines is toggled line by line, since markdown emphasis cannot cross a line
  break.
- **With items selected** (not typing): Cmd+B / Cmd+I toggle the style on
  their whole text, as one undo step. If every word already has the style it
  comes off; otherwise the whole line gets it.

## Truncation

- A shape's label first shrinks to fit (down to 11px). If it still doesn't
  fit, it is cut to the lines that fit, the last ending in `…`, and a small
  caret appears at the bottom of the shape.
- Clicking the caret grows the shape to fit the whole label at its own size
  (one undo step; arrows follow). The shape remembers the height it started
  from as `ex`, and the caret flips to point up; clicking it again shrinks the
  shape back and removes `ex`.
- Sticky notes have a fixed size, so overflowing text is cut with `…` but has
  no caret.
- The caret is a board control: it is hidden in the in-note preview and in
  saved files and exports.

## Not doing

- Rich text that hides the marks while typing (needs a rich-text editor in
  place of the textarea).
- Toolbar buttons for bold and italic.
- Underline, strikethrough, links.
