---
id: TASK-167
title: >-
  Read the server's rate-limit headers instead of guessing windows from the 429
  body
status: To Do
assignee: []
created_date: '2026-11-26T00:23:00Z'
updated_date: '2026-11-26T00:23:00Z'
labels:
  - api
  - rate-limit
dependencies: []
priority: medium
ordinal: 98920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Server TASK-249 (PR #294, 66f1e4af6) now sends Access-Control-Expose-Headers for Retry-After, X-RateLimit-Bucket, X-RateLimit-Global, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Reset-After on every response, so the cross-origin client can read them. Lila 11-24 ruling: fix the server, drop the client workaround. src/webpage/utils/rateLimitWindows.ts reads windows from the 429 body alone and mirrors the server's bucket key client-side (its header comment says the server sends no headers to a cross-origin client: now stale). Scope: prefer X-RateLimit-Reset-After / Retry-After for the wait, X-RateLimit-Global for global windows, and decide whether X-RateLimit-Bucket replaces the client-side bucket mirror (it would also close the documented error-limiter gap only if the server reports it). Keep the body read as the fallback for an instance still on older code (local A/B instances until their next deploy: headers.get() returns null there). Also cover the XHR path (retryAfterMsFromBody). Consider pre-emptive waits from X-RateLimit-Remaining=0 (Discord-parity behaviour) as a separate decision. Real-server tier can verify once a deployed instance carries 66f1e4af6.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Server session (11-25): it pings on the next A/B deploy carrying 66f1e4af6; if this task reaches its real-server tier first, message Machloket Server and it deploys for the probe.
<!-- SECTION:NOTES:END -->
