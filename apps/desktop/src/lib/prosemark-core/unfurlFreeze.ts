import { Facet } from "@codemirror/state";

/**
 * When any provider contributes `true`, prosemark's `hideExtension` and
 * `foldExtension` skip selection-driven rebuilds — decorations stay frozen in
 * their last computed shape. Doc changes still re-map positions so the
 * decoration set stays coordinate-valid; only the selection-touch
 * recomputation is suppressed.
 *
 * Intended for pointer drag gating: freeze unfurl/hide decisions between
 * pointerdown and pointerup so text doesn't reflow under the cursor.
 */
export const unfurlFreezeFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

/**
 * When any provider contributes `true`, decorations that unfold under the
 * selection (prosemark's fold and hide extensions, and the Pensée decorations
 * reading `getEffectiveSelectionRanges`) treat the selection as absent, so
 * everything renders folded. For an editor that shows content without owning
 * the caret: a linked-block embed that isn't focused keeps a selection at 0,
 * which would otherwise unfold a picture's `![](...)` source on load.
 *
 * Fold and hide rebuild when this value flips; ViewPlugin readers should do
 * the same (compare `startState` and `state`).
 */
export const selectionInertFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});
