---
id: TASK-93
title: A 429'd message's resend queues behind later sends (send order after a 429)
status: To Do
assignee: []
created_date: '2026-11-23T17:01:00Z'
updated_date: '2026-11-23T17:13:00Z'
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
<!-- SECTION:NOTES:END -->
