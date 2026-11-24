---
id: TASK-101
title: >-
  PR #190 review lows: fakeXHRByHand payload_json guard; pump-reset test
  wall-clock wait
status: Done
assignee: []
created_date: '2026-11-23T22:26:00Z'
updated_date: '2026-11-24T01:29:00Z'
labels:
  - tests
  - rate-limit
dependencies: []
priority: low
ordinal: 32920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
claude-review lows on PR #190 (TASK-97, merged 349d44f6). (1) src/webpage/messageSend.test.ts fakeXHRByHand.send: a FormData body without payload_json makes JSON.parse(null).content throw a generic TypeError; add a guard or explicit assertion so the failure reads clearly. (2) src/webpage/utils/rateLimitWindows.test.ts 'a pump whose line a reset emptied wakes without throwing' waits a fixed 120 ms against a 50 ms window; the only remaining wall-clock wait. Option: a test-only pump-finished signal, or fake timers; keep the sleep if neither is clean (record why).
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped in PR #191 (54a5faa2): the pump-reset test runs on fake timers; fakeXHRByHand throws a named error on a missing payload_json. Review lows filed as TASK-102.
<!-- SECTION:FINAL_SUMMARY:END -->
