---
id: TASK-155
title: invalidateAccount re-adds an account another tab removed
status: To Do
assignee: []
created_date: '2026-11-25T18:05:00Z'
labels:
  - auth
dependencies: []
priority: low
ordinal: 86920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in TASK-153. invalidateAccount's live pass persists through tryUpdateLocal when no stored record exists; updateLocal writes info.users[uid] = this.json, so an account another tab removed since comes back as a logged-out entry. Fix shape: when the stored record is absent, flip the live instances only and skip the save; check E5 semantics in utils/accountSave.test.ts first (trap 43). Red-first: remove the stored entry, 401 + dead probe, assert no entry reappears.
<!-- SECTION:DESCRIPTION:END -->
