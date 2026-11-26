---
id: TASK-184
title: >-
  apiFetch timeout test and messageSend slowmode test flake under full-suite
  load
status: To Do
assignee: []
created_date: '2026-11-26T17:31:00Z'
labels:
  - test
  - flake
dependencies: []
priority: medium
ordinal: 115920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First sighting 2026-11-26, TASK-173 gate (deck-job mc-t173-gate, sha 8b165de7, swap ~6.5 GB): 2 failed / 2500 passed. (1) apiFetch.test.ts "timeout triggers the offline refusal path without waiting 30 s (fetch and XHR)": expected bubble.failed called 1 times, got 0 (apiFetch.test.ts:265, ran 5.5 s). (2) messageSend.test.ts "(slowmode (a JSON error body)) removes its bubble once, with no retry left on a removed bubble": expected [] to deeply equal ["NotOk"] (ran 6.3 s). TASK-173 touches neither path (localuser.ts gatewayAuthFailed only). Both files alone in the same tree: 117/117 passed. Inference, not runtime-confirmed: vi.waitFor default timeout or real-timer waits too short under load. Trigger: a second sighting of either test promotes this to a structural fix (wait on observable state, red-first under load).
<!-- SECTION:DESCRIPTION:END -->
