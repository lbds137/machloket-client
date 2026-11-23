---
id: TASK-94
title: >-
  Two load-sensitive unit tests: historyFetch window check (20 ms real wait) and
  streamedLists ban-list cut
status: Done
assignee: []
created_date: '2026-11-23T17:25:00Z'
updated_date: '2026-11-23T18:44:00Z'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-23 unit. historyFetch :233: the 20 ms sleep becomes vi.waitFor on the armed window. Red: with the 429 delayed 40 ms in a probe copy, the old test fails 'expected 0 to be greater than 0' (the gate's assertion); the waitFor form passes. streamedLists :125: cause NOT reproduced in the browser. A 30 ms main-thread stall (before the chain, and in a later task, 3 runs each), a 0 ms error timer: all green with the old fixture; only a synchronous error loses the chunk. The lost-chunk theory (error() discards an unread chunk, true in a node probe) needs a task hop before the first read, and code reading finds none (progessiveLoad's idle timer is a guard; apiFetch's dynamic import is 401-only). What WAS observed: the failure line can render a task before alice's row (makeBanList appends rows on setTimeout 0) → filed TASK-95. Test fix: wait for the end state (line AND alice) instead of asserting alice the moment the line appears. Fixture left unchanged. Invite tests use the same fixture but render before failure.show (synchronous), so they keep their shape.

Council review (gpt-6.2-sol): pass. Applied: cutMidList now fails on the read after its first chunk (pull) instead of a 10 ms timer, so the cut doesn't depend on reader speed (this supersedes 'fixture left unchanged' above; still not shown to be the gate failure's cause); alice asserted inside a .bandiv row; comment reworded. Checked, no change: the failure line's text is set only in show() with hidden=false, so the textContent match means visible. Residual: historyFetch's third check needs the 2 s window still open after waitFor (max 1 s); setup.ts resets windows per test.

Merged in PR #186 (2026-11-23). claude-review PASS, lows: (1) status → Done here; (2) the gate's ban-list failure stays unexplained: if streamedLists :128-area fails again with the pull fixture and end-state wait, reopen with the run's log; the remaining candidate is the lost-chunk theory (needs a task hop before the first read).
<!-- SECTION:NOTES:END -->
