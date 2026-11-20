---
id: TASK-15
title: 'U-store1: favorites growth bounds'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - store
dependencies: []
priority: medium
ordinal: 270
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
P7 MED growth (inherited): `src/webpage/favorites.ts:146`-163 keeps a full `old` duplicate; frecency keys never evicted (:433-485). All inside the one localStorage.userinfos string -> quota pressure -> the full-storage Dialog with no actionable cause. Fix: prune zero-weight entries, evict frecency, drop the duplicate.

(Line anchors may drift — re-grep the named file at unit time.)
<!-- SECTION:DESCRIPTION:END -->
