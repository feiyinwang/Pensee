# TODOS

## Up Next

- Website: when the site moves to its own domain, change `SITE_URL` in `apps/website/src/site.ts`.
- In-context tips: one tip per feature, shown where it lives, done when you do it; screen 4 becomes optional. Spec: [SPECs/in-context-tips-spec.md](./SPECs/in-context-tips-spec.md)

## In Progress

- Talk notes: Record in a note, the pen asks before each new topic, live Pele diagrams drawn with Arc, Whisper on the Mac (ElevenLabs optional), audio + transcript in the note, Continue, Recordings space. Spec: [SPECs/talk-notes-spec.md](./SPECs/talk-notes-spec.md)
  - [x] 1. Pele + Arc for mermaid blocks
  - [x] 2. Record to Recordings/ and the audio embed
  - [x] 3. Whisper transcription and the transcript callout
  - [ ] 4. Ask: live topics and diagrams
  - [ ] 5. Continue, Recordings space, Settings, ElevenLabs

## Done

- Pensée builds for Windows from the same code, with macOS unchanged: Windows window config, paths sent over IPC in one spelling, Ctrl labels, Mac-only features gated, a Windows CI job and a release workflow for the installer ([docs/platforms.md](./docs/platforms.md)).
- YouTube links with a time (`t=210`, `t=3m30s`, `#t=`, `start=`) play from that time in their note, a video already in Library too ([spec](./SPECs/youtube-notes-spec.md)).
- Website: pages from `apps/website/content/{articles,docs,essays}/`, with templates, sitemap.xml, robots.txt and llms.txt ([spec](./SPECs/website-pages-spec.md)).
