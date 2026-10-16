# Board docking: Glow + Ping

Replaces the docking spark (the bolt) with a quieter feedback that still shows two cards snapping together. Decided on 2026-10-16 from three prototype rounds (`proto/board-snap/`, since deleted).

## What it is

Drag a card (or a group) within reach of another card and let go: the dragged cards dock after it, joined by a new arrow. The feedback has two parts.

**While a dock is offered**

- Each dragged card's **imprint** sits where it will land: its own outline, a 5% foreground fill and a 1px ink hairline at 0.32. This replaces the dashed ghost boxes. When the lit card will move to sit level with its next steps, its new spot is drawn as an imprint too.
- The **arrow it will get** is previewed, routed exactly as the board will route it, lit in the lit card's colour (a 1.5 core, a soft blurred under-stroke) in a group at 0.55.
- The lit card and the imprints carry a soft **halo** in that colour (8px stroke, blurred). It breathes once a **beat** (1600ms), between 0.65 and 1 of its strength (0.6).
- A small **port** dot (3px) sits where the arrow leaves the lit card. At each peak of the beat a **ring** goes out from it: 3 → 14px over 960ms on --ease-out, fading from 0.6.

**On drop**

- The cards **glide** from where they were let go into their spots: 180ms (--motion-settle) on --ease-out. The new arrow firms up from 0.4 to full over the same time, and the imprints fade.
- A **dot** runs the new arrow (220ms, --ease-out). As it arrives, the docked card's halo flares (120ms) and settles away (480ms), and one ring plays at its port (380ms). The lit card's halo and the lit arrow fade meanwhile.

Colour is the lit card's outline colour, or the foreground for notes and outline-less shapes, so the light follows the user's palette. Everything ignores the pointer. Under `prefers-reduced-motion` the imprints, arrow and halo are drawn still (full strength, no ring) and nothing plays on drop.

## Rejected

- **Bolt** (the old spark): crackling outline, arcing bolt and current racing round the card. Lively, but too electric and too loud for Pensée's restraint.
- **Ink** (a pen's thick–thin stem and stroke), **Settle** (motion only: lean and spring), **Stitch** (a running stitch pulled tight): not elegant enough; Stitch read as craft, Settle as nothing at all.
- **Register** (crop marks), **Paper** (lift and shadow), **Pilcrow** (a ¶ in the gap): elegant but flat. Paper's shadow barely reads on the dark board; the ¶ turns to a smudge at UI sizes.
- **Preview** alone (imprint + faint arrow + glide): the right base, but too plain; kept as the base of the final design.
- **Current** (a streak of light along the arrow, trace round the card), **Magnet** (pull toward the slot, overshooting spring): Current was closest to Bolt and still busy; Magnet's pull fights the pointer.
- **Glow** and **Ping** each on their own: Glow was liked, Ping added a clear "it's live" cue; together on one beat they read as one heartbeat instead of two effects.

## Code

- `board-spark.ts` owns the look: `drawCharge` (returns a view whose `beat(ms)` updates only attributes each frame), `playFlow` (the drop), `glideInto` (the cards' settle).
- `board-canvas.ts` decides what to show: the landings, the preview routes (`routeLinker` on a scratch scene holding the moved cards and the would-be arrows), the beat loop while a dock is offered, and the glide on drop.
