---
id: TASK-92
title: >-
  waitRateLimit can resume same-window waiters out of order (send-order risk
  after a 429)
status: To Do
assignee: []
created_date: '2026-11-23T15:44:00Z'
updated_date: '2026-11-23T15:45:00Z'
labels:
  - u-api
  - test-flake
dependencies: []
priority: high
ordinal: 23920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Gate run 2026-11-23 (TASK-90 branch, final tree; the same suite was green an hour earlier): src/webpage/utils/rateLimitWindows.test.ts 'resumes its callers in the order they started waiting' failed with expected [ 'b', 'a' ] to deeply equal [ 'a', 'b' ]. Hypothesis from code reading, not runtime-confirmed: waitRateLimit (src/webpage/utils/rateLimitWindows.ts:144) keys a shared setTimeout by deadline; on wake each waiter re-checks rateLimitRemaining via Date.now(). If the timer fires about 1 ms before Date.now() reaches the deadline (timer clock vs wall clock), the first waiter sees remaining>0 and re-arms, and the second sees 0 and goes first. Product impact: channel.ts awaits waitRateLimit before queued sends (channel.ts:4765, :4821), so sends held behind a 429 could go out in a different order. Fix direction: a per-window FIFO queue (or treat remaining<=small epsilon / re-check only once the shared wait resolves in order), red-first with a forced-skew test (stub Date.now). Trigger: next unit after TASK-90.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Prep 2026-11-23 (code reading): a second path to the same overtake: waitRateLimit calls Date.now() again at rateLimitWindows.ts:150, apart from rateLimitRemaining's own now, so a ms tick between them gives two waiters different end keys and separate timers. Fix shape: a per-bucket FIFO chain (each waiter awaits the previous waiter of its bucket, then runs its own re-check loop), order kept whatever the timers do. Red: stub Date.now with a 1 ms skew so the first waiter sees remaining>0 on wake.
<!-- SECTION:NOTES:END -->
