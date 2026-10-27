# TODOS

## Up Next

- Website: when the site moves to its own domain, change `SITE_URL` in `apps/website/src/site.ts`.
- In-context tips: one tip per feature, shown where it lives, done when you do it; screen 4 becomes optional. Spec: [SPECs/in-context-tips-spec.md](./SPECs/in-context-tips-spec.md)

## In Progress

## Done

- Codex (ChatGPT) as a second AI beside Claude Code: the chat, the pen and talks on `codex app-server`; onboarding asks for Claude or ChatGPT. Spec: [SPECs/codex-spec.md](./SPECs/codex-spec.md)
- Website: a Talk section, first under the hero with a New tag: one talk the visitor plays and redraws, then stops into the note (decided from proto/voice-section). Spec: [SPECs/website-homepage-spec.md](./SPECs/website-homepage-spec.md#talk-section)
- Record as a dot that steps aside while you scroll or write (decided from proto/record-dock). Spec: [SPECs/talk-notes-spec.md](./SPECs/talk-notes-spec.md#recording)
- Section rail as one line on the right edge: a segment per heading sized by its section, hover opens the list; replaces the ticks and the standing outline. Spec: [SPECs/section-indicators-spec.md](./SPECs/section-indicators-spec.md)
- Talk notes: Record in a note, the pen asks before each new topic, live Pele diagrams drawn with Arc, Whisper on the Mac (ElevenLabs optional), audio + transcript in the note, Continue, Recordings space. Spec: [SPECs/talk-notes-spec.md](./SPECs/talk-notes-spec.md)
  - [x] 1. Pele + Arc for mermaid blocks
  - [x] 2. Record to Recordings/ and the audio embed
  - [x] 3. Whisper transcription and the transcript callout
  - [x] 4. Ask: live topics and diagrams
  - [x] 5. Continue, Recordings space, Settings, ElevenLabs
- Pensée builds for Windows from the same code, with macOS unchanged: Windows window config, paths sent over IPC in one spelling, Ctrl labels, Mac-only features gated, a Windows CI job and a release workflow for the installer ([docs/platforms.md](./docs/platforms.md)).
- YouTube links with a time (`t=210`, `t=3m30s`, `#t=`, `start=`) play from that time in their note, a video already in Library too ([spec](./SPECs/youtube-notes-spec.md)).
- Website: pages from `apps/website/content/{articles,docs,essays}/`, with templates, sitemap.xml, robots.txt and llms.txt ([spec](./SPECs/website-pages-spec.md)).
