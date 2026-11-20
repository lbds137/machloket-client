---
id: TASK-16
title: 'U-store2: perminfo growth + the IndexedDB move'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - store
dependencies: []
priority: low
ordinal: 280
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
P7 cont.: perminfo per guild/channel never removed (`src/webpage/guild.ts:1915`, `src/webpage/channel.ts:971`). Then the bigger design pass: move account/userinfo storage off localStorage onto IndexedDB. Sequence after U-store1 and the full-storage rider pack — it touches every store surface.

(Line anchors may drift — re-grep the named file at unit time.)
<!-- SECTION:DESCRIPTION:END -->
