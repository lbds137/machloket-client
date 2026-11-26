---
id: TASK-167
title: >-
  Read the server's rate-limit headers instead of guessing windows from the 429
  body
status: Done
assignee: []
created_date: '2026-11-26T00:23:00Z'
updated_date: '2026-11-26T11:27:00Z'
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

2026-11-26 grounding (server src/api/middlewares/RateLimit.ts at 66f1e4af6): every limiter in the chain res.set()s its own headers, so on a 429 X-RateLimit-Bucket names the limiter that refused: "global", "ip", "error", or the encodeURI route pattern WITHOUT the major id (server RateLimit.test.ts:665: every channel id reports the same bucket). So the header cannot replace the client bucket mirror (which keys per major id); it CAN close the error-limiter gap: Bucket "error" means an IP-wide window, arm it base-wide. 429 sets Retry-After = ceil(retry_after) (integer s, never shorter than the body), X-RateLimit-Global "true" for global/ip; InFlightBodyBudget 429 sends Retry-After 1 + Global false. Plan: armRateLimit takes the response headers; wait = Retry-After, else X-RateLimit-Reset-After, else body retry_after, else 5 s (cap 30 s); global = header "true" or body global; Bucket "error" arms base-wide. Same for fetchRetryOnce untracked-URL wait (retryAfterMs) and the XHR send path (getResponseHeader). Old instances: headers null, body fallback. Pre-emptive Remaining=0 waits: a separate task.

Plan revised (2026-11-26): (a) no X-RateLimit-Reset-After: every limiter 429 sets Retry-After, and on a non-limiter 429 Reset-After is just a route window; order is Retry-After header, then body retry_after, then 5 s, cap 30 s. (b) Bucket "error" is NOT read as base-wide (it is also the header on every response of a route without a route limiter); the gap stays documented and the server ask is TASK-178. (c) Pre-emptive Remaining=0 waits split to TASK-177. Global = header X-RateLimit-Global "true" OR body global true. Sites: apiFetch armRateLimitFrom429, fetchRetryOnce untracked path, the send XHR onload.

Shipped in PR #225 (a2afb1cb), 2026-11-26: wait from Retry-After (capped 30 s), base-wide window on X-RateLimit-Global true; body fallback for older instances. TASK-89 item (6) folded as comments. claude-review lows 2-4 carried in the role file (console noise from getResponseHeader on unexposed headers; XHR-path Global test; ~3 s real-timer waits); low 1 filed separately.
<!-- SECTION:NOTES:END -->
