---
id: TASK-97
title: >-
  Rate-limit ordering tests: attachment path, deterministic 429 order, reset
  comment
status: Done
assignee: []
created_date: '2026-11-23T19:35:00Z'
updated_date: '2026-11-23T22:27:00Z'
labels:
  - tests
dependencies: []
priority: low
ordinal: 28920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From PR #187's claude-review (TASK-93), lows 1, 2, 4. (1) No test covers sendMessage's attachment (FormData) path with tickets, nor retryByHand when resend() throws (.catch -> fail, retry button works again). (2) rateLimit.test.ts 'two 429'd calls retry in the order they were made' uses a fixed 20 ms sleep to ensure b's 429 is read first; on a loaded runner it can pass whatever the order (false green). Replace with a deterministic signal, e.g. a test-only queue-length getter. (4) resetRateLimitsForTests empties sleeping pumps' lines, so a caller still parked from an earlier test never settles; say so in its doc comment. Low 3 (retry button no longer sends synchronously) needs no change: the click handler removes the button synchronously.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #190 (merged 349d44f6). Review lows → TASK-101.
<!-- SECTION:NOTES:END -->
