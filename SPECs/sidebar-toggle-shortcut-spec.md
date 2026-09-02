# Sidebar Toggle Shortcut Spec

## Summary

Bind `Cmd+[` to toggle the sidebar and move the toggle button to the sidebar's edge, directly before the back/forward history arrows in the tab chrome.

## Design

- `Cmd+[` joins `Cmd+\` in `useKeyboardShortcuts`; both are ignored in compact single-file windows like the existing binding.
- CodeMirror's `defaultKeymap` binds `Mod-[` to indent-less and only calls `preventDefault`, never `stopPropagation`, so the global handler would fire alongside it. `basicSetup.ts` exports `editorDefaultKeymap`, which moves indent-less and indent-more to `Mod-Shift-[` / `Mod-Shift-]`, and every editor in the app (main, columns, mermaid source) uses it. `Shift+Tab` is unchanged.
- The toggle leaves its own absolutely positioned container and renders inside the tab chrome container, before `EditorTabs`, so it moves with the sidebar edge on drag and toggle. The chrome container is now rendered on the welcome view too (toggle only), preserving the old always-visible toggle.
- Collapsed chrome offset drops from 132px to 92px: the traffic-light clearance, since the toggle no longer needs its own 40px slot before the tabs.
- The button adopts the history arrows' styling (control height, 28px wide, muted icon to secondary on hover) and shows the shortcut in its tooltip.

## Out of scope

- A native menu item for the toggle.
- Windows/Linux tooltip text (the hint shows the macOS glyph).
