# Window Zoom Spec

## Summary

`Cmd+=` / `Cmd++` zooms the whole window in, `Cmd+-` zooms out and `Cmd+0` returns to 100%. The level persists across launches as a global setting so a reader who needs 200% gets 200% every time, which is the WCAG 1.4.4 (Resize Text) requirement. Zoom is real page zoom (WebKit `pageZoom`, via Tauri's `setZoom`), not a font-size multiplier: every CSS pixel scales, layout reflows at the narrower effective viewport, and nothing has to be re-measured in app code.

## Design

- **Setting.** `appearance.zoom` is a global-scope `range` in percent (50–300, step 5, default 100). It renders as a slider in Appearance like the theme ranges do, so the level is visible and adjustable without the keyboard.
- **Ladder.** The keyboard steps snap to the browser ladder `50 · 67 · 75 · 80 · 90 · 100 · 110 · 125 · 150 · 175 · 200 · 250 · 300` from whatever the current value is (a slider value of 96 steps to 100, then 110). `lib/zoom.ts` owns the ladder, clamping and `stepZoom`.
- **One write path.** Keyboard, menu and slider all go through `setSetting("appearance.zoom")`. The setting's side effect, `applyZoom`, runs from `applySettingsSideEffects` alongside the theme and CSS-var bindings, so it fires on hydrate, on every optimistic write and on rollback. It skips the IPC when the level it last applied is unchanged.
- **Shortcuts.** `useKeyboardShortcuts` handles `Cmd+=`, `Cmd++`, `Cmd+-`, `Cmd+_` and `Cmd+0`. The board canvas already binds these to its own viewport zoom and calls `preventDefault` without `stopPropagation`, so the global handler yields when `e.defaultPrevented` is set. Compact windows zoom too; nothing about zoom needs a workspace.
- **Menu.** A native View submenu (Zoom In `Cmd+=`, Zoom Out `Cmd+-`, Actual Size `Cmd+0`) emits `menu:zoom-in` / `menu:zoom-out` / `menu:zoom-reset` to the focused window through the existing `emit_to_focused_window`. The accelerators never double-fire with the JS handler: WebKit only forwards a key equivalent to the main menu when the page did not `preventDefault` it, which is the same mechanism that lets `Cmd+W` close a tab instead of the window. Muda has no `Plus` key, so the menu shows `⌘=`.
- **Permission.** `core:webview:allow-set-webview-zoom` joins the default capability.

## 200% check

`e2e/specs/window-zoom.spec.js` drives the built app through the WebDriver harness: five synthetic `Cmd+=` presses take the setting to 200, `window.innerWidth` halves, the document has no horizontal overflow, and the sidebar, toggle button and status bar stay inside the viewport; `Cmd+-` steps to 175 and `Cmd+0` restores 100. The 200% screenshot shows the sidebar, tab strip, heading and prose reflowing at the halved width with nothing clipped. The status bar is an overlay at every zoom level, so it covers the last visible line until the document is scrolled, as it did before.

## Out of scope

- Live sync of a zoom change into other open windows. Global settings have no cross-window change event today; a window picks the level up on its next launch.
- Pinch-to-zoom on the trackpad.
- Text-only scaling. Page zoom is what the standard asks for, and it keeps chrome and content proportional.
