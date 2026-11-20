---
id: TASK-10
title: 'U-gw4: GIF-providers fetch inside the frame pipeline'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
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
