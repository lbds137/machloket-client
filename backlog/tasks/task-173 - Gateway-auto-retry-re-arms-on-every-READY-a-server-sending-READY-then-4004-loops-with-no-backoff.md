---
id: TASK-173
title: >-
  Gateway auto-retry re-arms on every READY: a server sending READY then 4004
  loops with no backoff
status: To Do
assignee: []
created_date: '2026-11-26T02:39:00Z'
labels:
  - gateway
  - robustness
dependencies: []
priority: low
ordinal: 104920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the PR #221 (TASK-157) claude-review, low. READY resets gatewayAuthRetried (localuser.ts, the READY case). If a server accepts IDENTIFY, sends READY, then closes 4004 while /users/@me answers alive, every cycle gets a fresh automatic retry, so READY -> 4004 -> probe -> reconnectAfterAuth -> init() repeats immediately, rebuilding the app each pass. Only a buggy server triggers it. Fix: re-arm only after the connection has stayed up for a while (the connectionSucceed + 20 s pattern the backoff path uses), or delay the automatic retry. Red-first: an e2e mock that sends READY then 4004 should show a bounded IDENTIFY count.
<!-- SECTION:DESCRIPTION:END -->
