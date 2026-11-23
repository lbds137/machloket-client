---
id: TASK-94
title: >-
  Two load-sensitive unit tests: historyFetch window check (20 ms real wait) and
  streamedLists ban-list cut
status: To Do
assignee: []
created_date: '2026-11-23T17:25:00Z'
labels:
  - tests
dependencies: []
priority: medium
ordinal: 25920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen in the TASK-92 gate run 3 (2026-11-23, full suite under deck-job): historyFetch.test.ts:233 'another call's failure doesn't release a window this call didn't arm' failed with expected 0 to be greater than 0 (the 429's window was not armed within the test's real 20 ms wait), and streamedLists.test.ts:125 'a ban list cut mid-body keeps the bans that arrived' failed with the failure line shown but 'alice' absent. Repro rates: historyFetch alone 0/6 at HEAD 9822a7e0 and 0/6 with the TASK-92 change; paired with streamedLists 0/6 at HEAD, 1/11 with the change. Code-reading: the window is armed in apiFetch before any queue code runs, so the 20 ms real wait races the 429 body read under load; not runtime-confirmed. Fix shape: wait for the arm with vi.waitFor instead of a fixed sleep; same for the streamed ban list's partial render.
<!-- SECTION:DESCRIPTION:END -->
