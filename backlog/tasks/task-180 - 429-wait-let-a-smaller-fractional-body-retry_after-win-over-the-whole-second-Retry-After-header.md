---
id: TASK-180
title: >-
  429 wait: let a smaller fractional body retry_after win over the whole-second
  Retry-After header
status: To Do
assignee: []
created_date: '2026-11-26T11:27:00Z'
labels:
  - rate-limit
dependencies: []
priority: low
ordinal: 111920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the claude-review of PR #225 (TASK-167), 2026-11-26. retryAfterMsFromHeaders(...) ?? retryAfterMsFromBody(...) (src/webpage/utils/rateLimitWindows.ts, retryAfterMs and armRateLimit) prefers Retry-After, which is whole seconds, over the body retry_after, which is fractional. If the server rounds the header up, a 429 whose body says 0.2 waits a full 1 s: never early, but up to ~1 s of extra latency per rate-limited send or fetch. User-visible (send latency), so filed rather than carried. Fix shape: when both are usable, take the body value if it is <= the header value; red-first with header 1 / body 0.2. First check the server: if its Retry-After is ceil(reset-after) the gap is real; if it sends the same precision, close as obsolete.
<!-- SECTION:DESCRIPTION:END -->
