# Note Header Menu Spec

## Goal

Rename or delete a note from its header, without finding it in the sidebar.

## Behavior

- **Where.** Right-clicking a note's header opens one menu. The header is
  either its tab in the tab bar or its column's header in the column strip.
  Book tabs and other non-note tabs have no menu.
- **Items:**
  - Close
  - Close others
  - Close all
  - Reveal in sidebar
  - Copy path
  - Rename
  - Delete
- **Rename** turns that header's title into a field holding the file name
  (no extension), with the name selected:
  - Enter or clicking away renames.
  - Escape keeps the old name.
  - A name that is taken is refused with an alert, as in the sidebar.
- **Delete** moves the file to the Trash and closes its tabs. It asks first
  only when the note has unsaved changes, which the Trash would not hold.
  This is the same as the sidebar's Delete.

## Implementation

- `lib/file-actions.ts` is the one write path for renaming, moving and
  deleting (`applyPathChange`, `renameFileStem`, `deleteFile`). The sidebar's
  inline rename, drag-to-move and file Delete now go through it too.
- `editor-area/tab-menu.ts` (`showTabMenu`) builds the menu for both headers
  from `buildTabMenuItemsSpec`.
- `editor-area/tab-title-rename.tsx` is the in-place name field.
