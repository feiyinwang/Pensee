# Sidebar Toggle Shortcut Spec

## Summary

Bind `Cmd+[` and `Cmd+]` to toggle the sidebar and move the toggle button to the sidebar's edge, directly before the back/forward history arrows in the tab chrome.

## Design

- `Cmd+[` and `Cmd+]` join `Cmd+\` in `useKeyboardShortcuts`; all are ignored in compact single-file windows like the existing binding.
- CodeMirror's `defaultKeymap` binds `Mod-[` to indent-less and only calls `preventDefault`, never `stopPropagation`, so the global handler would fire alongside it. `basicSetup.ts` exports `editorDefaultKeymap`, which moves indent-less and indent-more to `Mod-Shift-[` / `Mod-Shift-]`, and every editor in the app (main, columns, mermaid source) uses it. `Shift+Tab` is unchanged.
- The toggle stays in its own absolutely positioned container in `app-layout.tsx`, but its left edge is computed from the sidebar width: inside the sidebar header, 12px from the divider, when open; beside the traffic lights (92px) when collapsed. It shares the sidebar's settle transition so it rides along on drag and toggle.
- The tab chrome starts 4px after the toggle when collapsed (124px) and 12px past the sidebar edge when open, as before.
- The button adopts the history arrows' styling (control height, 28px wide, muted icon to secondary on hover) and shows the shortcut in its tooltip.

## Out of scope

- A native menu item for the toggle.
- Windows/Linux tooltip text (the hint shows the macOS glyph).
