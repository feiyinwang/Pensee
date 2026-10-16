# Section Indicators Spec

## Summary

Show small markers along the left edge of the editor that represent the document's headings, so the user has a lightweight outline view without opening a full table-of-contents panel.

## Goals

- Visually represent each top-level heading as a marker on the left rail.
- Highlight the marker corresponding to the heading currently in view.
- Let the user click a marker to scroll directly to that heading.
- Stay unobtrusive — no panel, no labels by default.

## Non-Goals

- A full outline pane.
- Folding headings from the rail.
- Showing markers for sub-subheadings beyond a configurable depth in v1.

## UX Decisions

### Visual

- A thin column on the left edge of the editor body (between the body and the sidebar boundary).
- One short horizontal tick per heading. Ticks are slightly indented for `H2`, more for `H3`, etc.
- The tick of the heading currently nearest the top of the viewport is brightened.
- Hovering the rail reveals a popover listing every heading in the document.

## Visual Design

The component is a vertical stack of short horizontal tick marks. Each tick represents one heading.

### Idle state

- Ticks: `2px` tall, stacked vertically with `6px` gap (so `8px` vertical pitch from the top of one tick to the top of the next).
- Color: foreground text color (black on light theme), no stroke, no corner radius.
- Inactive tick: `5px` wide, `20%` opacity.
- Active tick (heading currently in view): `10px` wide, `100%` opacity.
- Left edge of each tick is aligned to a single x-axis — the rail's inner padding offset.
- The rail has no background, no border, and no labels in idle state.

### Sketch

```
·····  ← inactive (5×2, 20% opacity)
·····
··········  ← active (10×2, 100% opacity)
·····
·····
·····
·····
·····
·····
```

### Tokens / measurements

| Property            | Value                       |
| ------------------- | --------------------------- |
| Tick height         | `2px`                       |
| Inactive tick width | `5px`                       |
| Active tick width   | `10px`                      |
| Vertical pitch      | `8px` (tick + 6px gap)      |
| Inactive opacity    | `0.2`                       |
| Active opacity      | `1.0`                       |
| Fill                | `currentColor` (foreground) |

### Hover state — heading popover

When the pointer enters the rail (or any individual tick), a popover appears anchored to the rail and lists every heading in the document as a clean, text-only outline.

- Container: rounded surface using the app's elevated panel token (matches the `⌘P` palette surface — opaque background, subtle border, soft shadow, generous corner radius). No header bar, no input, no group dividers.
- Anchor: aligned to the rail, opens to the right of the ticks. Vertical position roughly aligns the active row with the active tick.
- Padding: comfortable interior padding (~12–16px); rows have tight vertical rhythm (~4–6px gap), no per-row background.
- Width: fixed comfortable width; long titles truncate with an ellipsis (`Milestones (≈3 weeks t...`).

Row treatment — text color and weight do all the work; **there is no row background or hover highlight**:

- Inactive row: muted foreground, normal weight.
- Active row (heading currently in view): full foreground color, **bold** weight. Multiple actives can appear if multiple heading levels are simultaneously "in view" — e.g. the current `H1` and the current `H2` under it (matches the example where both `Positioning` and `Key flows` are bold).
- Indentation by depth: each level adds a fixed indent step so the tree shape is visible (`H1` flush left, `H2` indented, `H3` indented further, …) — mirrors the tick indentation in the rail.
- Cursor changes to pointer on a row; clicking scrolls to that heading and dismisses the popover.

Open/close behavior:

- Opens on pointer enter of the rail; persists while pointer is over the rail OR the popover.
- Dismisses on pointer leave of both, on `Esc`, or after a click.
- No search input, no keyboard navigation in v1 — passive outline, not a palette.

### Hover sketch

```
┌─────────────────────────────────┐
│  MVP Spec — AI-Native ...       │  ← inactive (muted)
│  Positioning                    │  ← active H1 (bold, full color)
│  Target user                    │
│  Scope                          │
│    In MVP                       │
│    Deferred (we can work ...    │
│  Architecture                   │
│  Key flows                      │  ← active H2 (bold, full color)
│  Tech stack                     │
│  Risks & open questions         │
│  Rough wireframe                │
│  Milestones (≈3 weeks t...      │
│  Success metrics                │
└─────────────────────────────────┘
```

### Interaction

- Clicking a tick scrolls the corresponding heading into view (smooth).
- Right-clicking opens a tiny menu with `Copy heading link`.

### Depth limit

- Default: H1-H3.
- Configurable in settings if/when settings ships.

## Standing outline (2026-10-16)

When the margin right of the text column has room, the rail opens up into a
standing outline instead of ticks behind a hover, after the "On this page"
table of contents on component docs sites (uiarc's Button page).

- **When.** The room is measured from `.cm-content` (its box minus its right
  padding is the text column) to the pane's right edge, less the scrollbar
  gutter. The outline keeps 40px off the text and 24px off the edge, grows
  with the room up to 240px, and gives way to the ticks below 180px
  (`outlineWidthForRoom` in `section-rail-depth.ts`). So a wide window shows
  it, and a narrow window, a wide page preset or side-by-side columns fall
  back to the ticks, each without a breakpoint table.
- **Where.** Top-aligned with the page header (96px, 40px in a column), fixed
  while the note scrolls; the list scrolls inside itself when it is taller
  than the pane and keeps the marked row in view. In a video note it starts
  24px under the video band instead (the video and the transcript beside it),
  next to the text: it rides up as the band scrolls to stick and stays under
  it once stuck, so it never covers the transcript or takes its wheel
  (`useOutlineTop` in `section-rail.tsx`).
- **Look.** A **On this page** label (label size, medium, primary), then one
  row per heading hanging off a 1px hairline (`--line-subtle`), indented by
  depth with the same sliding three-level window as the popover. Rows are
  muted; the heading in view and a hovered row are primary. The heading in
  view is marked by a 2px `--accent` bar on the hairline, as tall as its row.
  Long headings wrap to two lines, then clamp; the full text is in the
  tooltip. No row background.
- **Motion.** The marker slides between rows (transform only, 160ms
  ease-out); it lands without a slide when a file opens. None under reduced
  motion. Switching between ticks and outline is instant.
- **Same as the ticks.** Click scrolls to the heading; right-click offers
  **Copy heading link**.

- **Wheel.** A wheel or trackpad scroll over the outline scrolls the note, as
  over the empty margin; the list never takes the wheel, it follows the mark.

Journeys ED-20–24.

## Implementation Notes

- Compute headings from the ProseMirror doc; subscribe to doc changes via the editor store.
- Compute the active heading via a scroll subscription that finds the heading whose top is closest to but above the viewport top.
- Use `IntersectionObserver` for performance instead of polling scroll.
- Render the rail as a sibling of the editor scroll container so it can pin to the viewport edge.

## Files Expected To Change

- `apps/desktop/src/components/editor-area/`
- new `apps/desktop/src/components/editor-area/section-rail.tsx`
- `apps/desktop/src/hooks/use-document-headings.ts` (new)
- frontend tests under `apps/desktop/tests/`

## Acceptance Criteria

- A vertical rail of heading markers appears on the left edge of the editor body.
- The marker for the currently visible heading is highlighted.
- Hovering shows the heading text; clicking jumps to that heading.
- The rail respects the configured depth limit.
