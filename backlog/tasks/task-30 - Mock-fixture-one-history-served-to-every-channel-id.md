---
id: TASK-30
title: 'Mock fixture: one history served to every channel id'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - e2e
  - test-robustness
  - deferred
dependencies: []
ordinal: 510
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Any spec opening two message-bearing channels gets shared message ids, which the client's user-wide maps treat as one chain (cost 11-02: a false data-loss bug, ~1h of probing). Fix: serve full history for the primary channel id only, per-channel/empty for extras; check which existing specs read history in a second channel. Trigger: the next spec needing second-channel history, or the next mock change.
<!-- SECTION:DESCRIPTION:END -->
