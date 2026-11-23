---
id: TASK-89
title: 'TASK-5 review lows: 429 body reads, webhook-token case, reset test'
status: To Do
assignee: []
created_date: '2026-11-23T03:53:00Z'
labels:
  - u-api
dependencies: []
priority: low
ordinal: 20920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Round-2 council lows on the TASK-5 (C8) registry, none blocking: (1) readBodyBounded races res.clone().text() against a timer but does not cancel the clone read, so a stalled body keeps draining (Spacebar 429 bodies are ~70 bytes); a reader-based read with cancel + byte cap is the shape. (2) The 429 body is read twice (apiFetch arming + fetchRetryOnce), each bounded 1 s; a WeakMap<Response, Promise<parsed>> would make it one read. (3) rateLimitKey lowercases webhook tokens; preserving their case is more precise (folding only over-blocks). (4) A fake-clock test that recreates a pre-reset deadline after resetRateLimitsForTests.
<!-- SECTION:DESCRIPTION:END -->
