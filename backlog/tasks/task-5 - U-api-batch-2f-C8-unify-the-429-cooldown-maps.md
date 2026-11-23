---
id: TASK-5
title: 'U-api batch 2f (C8): unify the 429 cooldown maps'
status: In Progress
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-23T03:04:00Z'
labels:
  - u-api
dependencies: []
priority: medium
ordinal: 140
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
C8 from the REST-contract review: 429 cooldown/window state lives in several maps (history window, send-XHR resend, typing, form). Unify through `src/webpage/utils/rateLimit.ts` so one armed window is shared per instance; the send+slowmode distinction (slowmode `code: 20016` reported under a 429 status takes the countdown, never retries) must survive the unification. After the site migration batches.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Grounding 2026-11-22: "typing" and "form" are fetchRetryOnce CALL SITES, not maps; the three implementations are fetchRetryOnce, the channel.ts history window (historyCooldownUntil), and the send-XHR resend. Server contract (machloket-server RateLimit.ts): body {message, retry_after s, global}; route buckets per full path; no Access-Control-Expose-Headers, so body only. Design: registry utils/rateLimitWindows.ts keyed by API base, global + per-path buckets; apiFetch arms on every 429; fetchRetryOnce/pager/send pre-wait (FIFO shared timer); 20016 never arms or retries (server sends slowmode as 400; 429+20016 is the Discord-compat guard). Narrows the b8c73a7a cross-channel history window to per-path per C8. Known gap: the server error limiter is IP-wide but reports global:false. Spec: docs/local/specs/task-5-c8.md.

Server side (Machloket Server, 2026-11-22): the missing Access-Control-Expose-Headers and the error bucket answering global:false will be filed there as TASK-249/TASK-250 after server PR #209 merges. Until then the client reads only the 429 body. Trigger to revisit: if those land, global:true from the error limiter needs no client change; the exposed headers are optional.
<!-- SECTION:NOTES:END -->
