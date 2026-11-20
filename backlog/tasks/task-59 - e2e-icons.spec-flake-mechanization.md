---
id: TASK-59
title: e2e icons.spec flake mechanization
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - e2e
  - test-robustness
  - deferred
dependencies: []
ordinal: 820
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
icons.spec.ts:101 timed out at the 30s test timeout twice under 2-worker concurrency (10-26), passed solo x3 and in the deciding full suite; clean-tree full-suite concurrency not sampled; no mechanism named tying it to the diff. Suspect boot-time budget under 2-worker + swap pressure. Fix shape when promoted: give the menu-open step its own expect window and/or gate the phone project's worker count. The general mechanized fix for the load-amplified e2e family is per-spec expect windows. Not fixed by rerunning.
<!-- SECTION:DESCRIPTION:END -->
