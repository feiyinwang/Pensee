# Link Paths With Spaces Spec

## Summary

Markdown links/images and existing wiki-style link resolution should work when spaces appear in link labels, image alt text, aliases, folder names, file names, note titles, and generated asset paths.

## Goals

- Parse standard Markdown links and images with local destinations that contain literal spaces.
- Resolve angle-bracket destinations like `<Project TODOs.md>` to the same local path as `Project TODOs.md`.
- Continue decoding percent-encoded local paths such as `Pensée%20TODOs.md`.
- Preserve spaces in wiki-link targets and aliases.
- Generate valid pasted-image Markdown when the destination path contains spaces.

## Non-Goals

- Add a new Obsidian embed feature.
- Migrate existing document text.
- Change Rust IPC contracts.

## Implementation Notes

- Add a shared frontend destination normalizer for stripping angle brackets, unescaping Markdown path escapes, and percent-decoding path segments.
- Add a small Lezer inline extension before the default Markdown `LinkEnd` parser so bare-space destinations produce normal `Link` and `Image` nodes.
- Keep quoted Markdown titles separate from destination URLs.
- Route rendered images, link navigation, context-menu link actions, and generic ProseMark URL extraction through the same normalization path.

## Acceptance Criteria

- `[Todo](Project TODOs.md)` opens `Project TODOs.md`.
- `![image.png](Project TODOs-assets/20260525-041412-e520.png)` renders the image.
- `[Todo](<Project TODOs.md>)` and `[Todo](Pensée%20TODOs.md)` resolve to the same file.
- `[[Folder With Spaces/My Note|Label With Spaces]]` resolves and displays correctly.
- Pasting an image into a note whose generated asset directory has spaces inserts a valid Markdown image destination.
