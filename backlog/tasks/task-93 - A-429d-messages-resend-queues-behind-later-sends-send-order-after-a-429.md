---
id: TASK-93
title: A 429'd message's resend queues behind later sends (send order after a 429)
status: Done
assignee: []
created_date: '2026-11-23T17:01:00Z'
updated_date: '2026-11-23T19:35:00Z'
labels:
  - u-api
dependencies: []
priority: medium
ordinal: 24920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in TASK-92's council review (2026-11-23), code reading, not runtime-confirmed: when a send gets a 429, channel.ts (the rateLimitRetried branch near 'await waitRateLimit(sendUrl, "POST")' ~:4679) re-sends after awaiting waitRateLimit, which queues it at the BACK of the bucket's FIFO (rateLimitWindows.ts queueTails). A message sent after the first one, already waiting in that queue, goes out before the resend, so the channel shows them out of the order typed. Fix direction: let a resend take its original place (e.g. a priority re-entry at the queue head, or hold the bucket's later sends until the resend is out); red-first with two sends where the first gets a 429. Trigger: next u-api unit after TASK-92.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-23 (TASK-92 review, gpt-6.2-sol): two more send-order edges for this unit. (1) The 429 retry inside fetchRetryOnce queues in 429-arrival order, not original send order. (2) Check-to-send gap: a waiter can pass its last remainingFor check, then an earlier caller's 429 re-arms the window before this waiter's caller sends; the send then goes out inside the new window (it would draw its own 429). A queue-owned dispatch (callback started before the slot is released) would close both; it needs every same-bucket send path migrated together.

From PR #185 review (TASK-92), lows to settle in this unit: (a) fetchHistoryPage (channel.ts:3800) skips the queue (gates on rateLimitRemaining): switch to rateLimitHeld or comment the intended bypass; (b) a stale fetchRetryOnce caller during the queue's linger task gets a synthesized 429 with no window armed: check each shouldRetry caller doesn't show a false 'rate limited' state; (c) add a test: global window armed while one bucket's waiters queue keeps FIFO (remainingFor reads the global end).

Shipped on branch task-93-send-order. Tickets: rateLimitTicket() gives each request a place in send order; waitRateLimit parks callers on a ticket-sorted per-bucket line driven by one pump, and a resend after a 429 reuses its ticket. Red-first: messageSend (resend before a later parked send; hand retry waits the window; hand retry gets its own resend after a 429) and rateLimit (two 429'd calls retry in call order, not 429-arrival order), all red at HEAD on their named assertions. Edges: (a) fetchHistoryPage reads the window, not the queue, on purpose (history pages carry no send order); commented in place. (b) audited every shouldRetry caller (message edit, guild/channel mute, ack-bulk, both acks, status, folders, search, typing): each gates its refusal on its own staleness seq, so a synthesized 429 for a stale call shows nothing. (c) pinned: a global window armed over a bucket's waiters holds them, still in order (green at HEAD). (2) the check-to-send gap is unreachable by code reading (not runtime-confirmed): apiFetch calls fetch before its first await and the XHR send runs synchronously after the wait, so check and send share a task and a 429 lands in a later one. Residual (a later send already on the wire) filed as TASK-96 for Lila. Council review (GPT): took the reset fix (reset empties sleeping pumps' lines) and a scoped ordering doc; batch release on window end is by design; double retry click ruled out (the retry button removes itself synchronously, channel.ts failed handler).

Merged: PR #187 (14615304), claude-review PASS. Lows 1, 2, 4 filed as TASK-97; low 3 no change (the retry button removes itself synchronously).
<!-- SECTION:NOTES:END -->
