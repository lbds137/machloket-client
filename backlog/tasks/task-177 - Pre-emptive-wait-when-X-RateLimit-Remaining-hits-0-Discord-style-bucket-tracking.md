---
id: TASK-177
title: >-
  Pre-emptive wait when X-RateLimit-Remaining hits 0 (Discord-style bucket
  tracking)
status: To Do
assignee: []
created_date: '2026-11-26T09:28:00Z'
labels:
  - rate-limit
dependencies: []
priority: low
ordinal: 108920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in TASK-167 grounding. The server now exposes X-RateLimit-Remaining/Reset-After to the cross-origin client (server TASK-249, CORS EXPOSED_HEADERS). Discord clients hold a bucket once Remaining reaches 0 until Reset-After passes, so they send no request that is sure to 429. Today the client only reacts to a 429. Caveats to settle first: each limiter in the chain (ip, global, error, route) writes its own headers in order, so the last writer wins and Remaining may describe a different limiter than the route; Bucket carries the pattern without the major id, so the client must key by its own mirror. Decide whether the saving is worth it on measured 429 rates before building.
<!-- SECTION:DESCRIPTION:END -->
