---
id: TASK-178
title: >-
  Server ask: a scope marker on limiter 429s so the client can tell the error
  limiter apart
status: To Do
assignee: []
created_date: '2026-11-26T09:28:00Z'
labels:
  - rate-limit
dependencies: []
priority: low
ordinal: 109920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in TASK-167 grounding. The server error limiter (IP-wide, every route, counts 4xx) answers 429 with X-RateLimit-Global false and X-RateLimit-Bucket "error", but "error" is also the bucket header on every response for routes with no route limiter (most /users/@me/*), so the client cannot infer a base-wide window from it and files the 429 under the request path only (the documented gap in rateLimitWindows.ts). Ask the server project for an explicit marker on its 429s, e.g. Discord X-RateLimit-Scope (user/global/shared), or X-RateLimit-Global true for the error limiter. Client side once it lands: arm the whole base on that marker in armRateLimit and drop the gap note. Server-side question, so it goes to the server project; this task tracks the client half.
<!-- SECTION:DESCRIPTION:END -->
