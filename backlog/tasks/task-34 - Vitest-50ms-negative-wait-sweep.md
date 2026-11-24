---
id: TASK-34
title: Vitest 50ms negative-wait sweep
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-24T17:01:00Z'
labels:
  - test-robustness
  - deferred
dependencies: []
priority: low
ordinal: 550
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
13 sites across 5 files: fetchRefusals:68, message:177, messageSearch:178+225, settingsGetRefusals x6, utils/pingGuard.test.ts:101+110+119 (the trio may be load-bearing timing — settle-analysis per site rules each in or out). The drain() helper in test/setup.ts makes conversion mechanical. Line numbers drift — re-grep setTimeout(r, 50) under src/webpage at unit time. Trigger: a test-robustness unit, or the next touch of any listed file.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-24: first observed failure. settingsGetRefusals.test.ts 'an instance-connection-types GET that never arrived says why and still mounts the pane' (~:516) failed once in a full gate (TASK-6 branch, t6-gate3) on its POSITIVE wait: expected the requestFailed('offline') text after setTimeout(r, 50), got the pane without it. 56/56 on three solo reruns, and the branch doesn't touch that code, so load timing. Positive 50 ms waits belong in this sweep too, not only negative ones.
<!-- SECTION:NOTES:END -->
