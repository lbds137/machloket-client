---
id: TASK-36
title: Webhook author missing-avatar normalize
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - deferred
dependencies: []
priority: low
ordinal: 570
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A webhook author payload with NO avatar field keys the cache like null (user.ts webhook uid uses avatar ?? null), and a fresh User keeps avatar undefined, so getpfpsrc builds /avatars/<id>/undefined.png. Reachable path: a MESSAGE_UPDATE carrying a partial author (localuser.ts ~1115 -> giveData -> new User). Normalize undefined->null at the User boundary (red test first); fix the cache-side undefined write together. Check what the server actually sends for a webhook message author on MESSAGE_UPDATE first.
<!-- SECTION:DESCRIPTION:END -->
