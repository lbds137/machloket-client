---
id: TASK-96
title: 'Decide: hold a channel''s later sends until an earlier send''s response arrives'
status: Done
assignee: []
created_date: '2026-11-23T19:03:00Z'
updated_date: '2026-11-23T19:35:00Z'
labels:
  - decision
  - needs-lila
dependencies: []
priority: low
ordinal: 27920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From TASK-93. Tickets (rateLimitTicket) put a 429'd send's resend ahead of later sends still parked on the bucket's window. They can't reorder a later send that is already on the wire when the earlier 429 lands: with A sent, B sent, then A answered 429, the wire reads A, B, A, and the channel shows B before A. Only holding each channel's next send until the previous send's response arrives (a per-channel send queue, as Discord's client does) closes it. Tradeoff, user-visible: a slow upload or a hung request then blocks every later message in that channel until it settles or times out. Owner's call: keep tickets only (current), or serialize sends per channel.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Ruled out by Lila 2026-11-23: tickets only. Serializing per channel would let one slow upload or hung request block later messages; the on-the-wire reorder stays as the accepted residual.
<!-- SECTION:NOTES:END -->
