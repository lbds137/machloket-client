---
id: TASK-155
title: invalidateAccount re-adds an account another tab removed
status: Done
assignee: []
created_date: '2026-11-25T18:05:00Z'
updated_date: '2026-11-26T00:42:00Z'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #219 (173acd77, merged 2026-11-26 as e25430f4). invalidateAccount saves only over a stored record that still holds the dead credential. CodeQL #91 (test fixture) dismissed per owner AUQ. Review lows -> TASK-168.
<!-- SECTION:NOTES:END -->
