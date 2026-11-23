---
id: TASK-78
title: >-
  Broken custom-emoji/sticker/icon images fall back gracefully (server deletes
  CDN files)
status: Done
assignee: []
created_date: '2026-11-22T21:56:00Z'
updated_date: '2026-11-23T00:33:00Z'
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
- [x] #1 A custom emoji whose image 404s renders as ':name:' text
- [x] #2 Stickers, webhook avatars, role icons and guild icons whose image 404s fall back to their no-image rendering (or a named fallback), never a broken-image icon
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #174, rebase-merged as 5 commits on main: f8b37fd5, ae1d6b0a, 10b22dc2, 918f98e4, 89901cb7. claude-review: round 1 BLOCK, round 2 BLOCK, round 3 PASS. Cross-family review via council/OpenAI, since Gemini's week was at 0%. Deliberately out of scope: settings-form initImg previews (the entity is live while edited), the my-apps cover (lists live apps only), the localuser CSS-background banner (a 404 paints nothing), channel icons (not in the server's delete set), and the deleted emoji's info menu (it would look up a gone emoji). Follow-ups: TASK-79 (initials), TASK-80 (setSrcs race), TASK-81 (offline recovery), TASK-82 (member -> user avatar), TASK-83 (dead emojiEl), TASK-84 (jumbo fallback size, Lila's call).
<!-- SECTION:NOTES:END -->
