---
id: TASK-10
title: 'U-gw4: GIF-providers fetch inside the frame pipeline'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-24T13:26:00Z'
labels:
  - gateway
dependencies: []
priority: medium
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
G5 MED robustness (inherited): gottenReady awaits the GIF-providers fetch (no timeout) inside the serialized frame pipeline, so the splash and every later frame wait on it. Fix: `void fetch(...).then(...)` like fetchMessageLimit. Red-first: a pending fetch must not block later frames.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-24 triage: kept medium. gottenReady still awaits the GIF-providers request (src/webpage/localuser.ts:559), but apiFetch now caps it at 30 s (src/webpage/utils/apiFetch.ts:5), so the stall is bounded.
<!-- SECTION:NOTES:END -->
