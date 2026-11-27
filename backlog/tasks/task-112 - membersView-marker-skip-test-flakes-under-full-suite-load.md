---
id: TASK-112
title: membersView marker-skip test flakes under full-suite load
status: In Progress
assignee:
  - machloket-client
created_date: '2026-11-24T04:53:00Z'
updated_date: '2026-11-27T01:30:00Z'
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
Bit again 2026-11-25 (TASK-155 final gate, sha 173acd77): membersView.test.ts:313 navStates length 0 vs 1 under the full suite; the file alone passed 3/3 right after.
<!-- SECTION:NOTES:END -->
