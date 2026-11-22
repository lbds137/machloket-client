---
id: TASK-78
title: >-
  Broken custom-emoji/sticker/icon images fall back gracefully (server deletes
  CDN files)
status: To Do
assignee: []
created_date: '2026-11-22T21:56:00Z'
labels:
  - parity
  - media
dependencies: []
priority: high
ordinal: 9920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Server PR #204 (machloket-server TASK-77, Lila's ruling 2026-11-22 14:55 'Delete both') makes deleting a custom emoji, sticker, role, webhook, application or guild also delete its CDN files. Old messages that used a deleted custom emoji then get a 404 from the CDN's /emojis/<id> path.

Today: Emoji.getHTML (src/webpage/emoji.ts:98-111) builds <img class=md-emoji alt=name> with no error handler, so a deleted emoji shows the browser's broken-image icon. createImg (src/webpage/utils/utils.ts:1027) only adds an 'error' class.

Do: on image error, replace a custom emoji with its ':name:' text (same size/flow as inline text; keep the hover). Then sweep the same 404 class: stickers, webhook avatars, role icons, guild icons/banners (fall back to the existing no-image rendering: initials, default avatar, no icon). Red-first unit tests driving the img 'error' event.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A custom emoji whose image 404s renders as ':name:' text
- [ ] #2 Stickers, webhook avatars, role icons and guild icons whose image 404s fall back to their no-image rendering (or a named fallback), never a broken-image icon
<!-- AC:END -->
