---
id: TASK-112
title: membersView marker-skip test flakes under full-suite load
status: Done
assignee:
  - machloket-client
created_date: '2026-11-24T04:53:00Z'
updated_date: '2026-11-27T04:55:00Z'
labels:
  - test
  - flake
dependencies: []
priority: medium
ordinal: 43920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/webpage/utils/membersView.test.ts:313 ("one Android back, with navigation stacked above the marker, lands on the channel below") failed once in the TASK-107 gate (deck-job mc-t107-gate, 2026-11-23 23:45, 1 failed / 2303 passed): expected [] to have a length of 1 but got +0. The TASK-107 diff touches only .gitignore and .claude/worktree-regenerable. The file passed 3/3 run alone in the same tree (docs/local/session-2026-11-23/t107-membersView-run{1,2,3}.log). Inference, not runtime-confirmed: the timer-based settle() (2x120 ms) is too short under full-suite load for the skip's own history.back() popstate to land. Fix shape: wait on the observable state (vi.waitFor on navStates / a popstate count) instead of a fixed timer, red-first by reproducing under load (e.g. CPU throttle or a shortened settle).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped as PR #236 (merged 534e32a, 3 commits: b928b988 membersView landing-waits, cb748c91 searchView class sweep, ba6c58d9 review-round marker-guard checks + pollution fix). Root cause: fixed 120 ms settles guessed the landing under full-suite load (bit gates 11-23 and 11-25); the skip's own mid-listener back() chains landings, so the waits now watch the observables (vi.waitFor, timeout 5000): view class drop, navStates counts, marker-state clears. Review history: agy gemini cross-family round-1 FIX-FIRST (refuted my class-sweep claim: searchView carried the identical class) -> applied; round-2 PASS. CI claude-review round on cb748c91 BLOCK (2 findings: lost overshoot detection; overstated afterEach comment) -> marker-guard navStates[0] checks added at the 4 unguarded sites; the new check then caught a REAL leak: the empty-member-panel test left its view open, its marker fell through the single-shot skip into navStates. Pollution fixed in-test; product-side gap filed as TASK-187 (single-shot skip vs searchView's chained backstop; traced unreachable in-app today). Round-3 PASS with 4 lows -> carried (carried-lows.md, PR #236). Gate t112-gate3: 2527/2527 unit (281 files), e2e 197/5. The two PR #234 test lows landed here as planned.
<!-- SECTION:NOTES:END -->
