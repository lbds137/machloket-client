---
id: TASK-188
title: 'Unit-suite real-wait units (baseline 11-27): service.test, cookieLogin'
status: To Do
assignee: []
created_date: '2026-11-27T08:28:00Z'
labels:
  - tooling
  - testing
  - deferred
dependencies: []
priority: medium
type: task
ordinal: 119920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the 11-27 baseline (docs/local/baseline-vitest.json, git-ignored): two unit files still pay real-timer waits the Unit D treatment (injectable budget, shorter holds, margins that outlast vi.waitFor polls) would shrink.

- service.test: 27.1s total, 17 tests at 2s or more (the largest real-wait block left in the vitest stage; stage total 145.6s under fleet load, peak 7 concurrent files proves config is not the cap).
- cookieLogin tests: ~10.5s over 16 tests (~0.65s average, holds scattered through the login flow).

Same rules as PR #238: never weaken or drop an assertion; inject the threshold; keep flake margins larger than any poll. Measure after with suite-time and record the numbers on the PR.
<!-- SECTION:DESCRIPTION:END -->
