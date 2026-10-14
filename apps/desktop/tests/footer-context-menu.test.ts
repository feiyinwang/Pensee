import { describe, expect, test, vi } from "vite-plus/test";

// The Tauri menu modules pull in `@tauri-apps/api/core` at import time, so we
// stub them up front. The pure helper under test (`buildFooterMenuItemsSpec`)
// never touches these stubs.
vi.mock("@tauri-apps/api/menu/menu", () => ({ Menu: { new: vi.fn() } }));
vi.mock("@tauri-apps/api/menu/checkMenuItem", () => ({ CheckMenuItem: { new: vi.fn() } }));

import {
  buildFooterMenuItemsSpec,
  FOOTER_METRICS,
  type FooterContextMenuState,
  type FooterItemSettingKey,
} from "../src/components/editor-area/footer-context-menu";

function makeState(
  visibility: Record<FooterItemSettingKey, boolean>,
): FooterContextMenuState & { toggles: Array<[FooterItemSettingKey, boolean]> } {
  const toggles: Array<[FooterItemSettingKey, boolean]> = [];
  return {
    toggles,
    visibility,
    onToggle: (key, visible) => toggles.push([key, visible]),
  };
}

describe("buildFooterMenuItemsSpec", () => {
  test("lists every footer item even when hidden, with checked reflecting visibility", () => {
    const state = makeState({
      "statusbar.show-words": true,
      "statusbar.show-characters": false,
      "statusbar.show-paragraphs": true,
      "statusbar.show-width": false,
    });

    const spec = buildFooterMenuItemsSpec(state);

    expect(spec.map((entry) => [entry.id, entry.text, entry.checked])).toEqual([
      ["statusbar.show-words", "Words", true],
      ["statusbar.show-characters", "Characters", false],
      ["statusbar.show-paragraphs", "Paragraphs", true],
      ["statusbar.show-width", "Page Width", false],
    ]);
  });

  test("toggling a visible metric requests hiding it, and vice versa", () => {
    const state = makeState({
      "statusbar.show-words": true,
      "statusbar.show-characters": false,
      "statusbar.show-paragraphs": true,
      "statusbar.show-width": false,
    });

    const spec = buildFooterMenuItemsSpec(state);
    for (const entry of spec) entry.action();

    expect(state.toggles).toEqual([
      ["statusbar.show-words", false],
      ["statusbar.show-characters", true],
      ["statusbar.show-paragraphs", false],
      ["statusbar.show-width", true],
    ]);
  });

  test("registry stat keys stay aligned with the DocumentStats shape", () => {
    expect(FOOTER_METRICS.map((metric) => metric.statKey)).toEqual([
      "words",
      "characters",
      "paragraphs",
    ]);
  });
});
