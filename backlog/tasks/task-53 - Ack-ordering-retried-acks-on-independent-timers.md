---
id: TASK-53
title: 'Ack ordering: retried acks on independent timers'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - probe-first
  - deferred
dependencies: []
ordinal: 740
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retried acks/sends on independent timers can land out of order (an ack regressing the read marker if the server is not monotonic). Probe first: ack an older id after a newer one, re-read the read-state. Trigger: a read-marker-regression report, or the server session confirming acks are not monotonic.
<!-- SECTION:DESCRIPTION:END -->
