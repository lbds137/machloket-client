---
id: TASK-89
title: 'TASK-5 review lows: 429 body reads, webhook-token case, reset test'
status: To Do
assignee: []
created_date: '2026-11-23T03:53:00Z'
updated_date: '2026-11-26T09:28:00Z'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PR #176 claude-review lows (2026-11-22): (5) a manual retry of a failed send bubble skips the window: channel.ts fail = () => funcs?.failed(resend) hands the raw resend; wrap it to await waitRateLimit(sendUrl, "POST") first, with a test row (manual retry inside an armed window waits). (6) fetchHistoryPage and the send-XHR 429 resend have no body retry_after fallback when rateLimitKey returns null (fetchRetryOnce has one); unreachable today since info.api is normalized to /v9, but add the fallback or a comment.

Correction (2026-11-26, TASK-167 grounding): item (3) premise is wrong. The server keys a webhook route on the route pattern plus the webhook id only (machloket-server src/api/middlewares/RouteBuckets.ts header comment: every key component is method/pattern/sentinel except one canonicalised major id), so the token segment never reaches its key. The accurate client mirror drops the token (collapses it like a param), not preserves its case; that changes the existing rateLimitWindows.test.ts "keeps a webhook token segment" assertion. Item (5) already shipped (channel.ts retryByHand waits waitRateLimit before resend). Item (6) is answered in the TASK-167 PR with comments: Specialuser normalizes every API base to end in /v9 (utils.ts:230), so sendUrl and msgsUrl always key; no fallback code.
<!-- SECTION:NOTES:END -->
