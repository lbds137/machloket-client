---
id: TASK-71
title: service.test CheckUpdate poll times out under full-suite load (third bite)
status: To Do
assignee: []
created_date: '2026-11-22T14:59:00Z'
updated_date: '2026-11-23T20:36:00Z'
labels:
  - test-flake
dependencies: []
priority: medium
ordinal: 2920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/webpage/service.test.ts 'a CheckUpdate against an up-to-date marker answers updates:false' timed out on until('the updates reply') (5 s default, service.test.ts until()) in the 2c gate2 full run 2026-11-22 (1 failed / 2154 passed; same tree's gate1 green). Prior bites: 2026-11-11 x2 at the then-3 s poll (docs/local/machloket-client-tasks-archive.md E2 notes), ruled 'own unit if it bites a third time'. Root-cause the worker-reply latency under concurrent browser-mode files (concurrent iframes on one origin, SW startup) rather than only raising the budget; keep the assertion intact.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-23 prep (machloket-client): (1) Cross-file takeover hypothesis (notificationHandler.test runs concurrently on the same origin; its afterEach unregisters all and its notification path can SW.register(true)) is weak by code reading: notificationRegistration reuses an existing registration (src/webpage/utils/utils.ts:1276), and unregister leaves a worker controlling the test's robots.txt frame alive. Paired runs of the two files: 3/3 green (23/23), no repro. (2) Remaining candidate: the worker's /getupdates fetch under full-suite load exceeding until()'s 5 s. Next step: a timeout diagnostic, not a budget raise: on until() timeout, send ping on the same port and record pong (alive) vs none (dead), plus the elapsed time, so the next bite yields evidence. Only then pick the fix.
<!-- SECTION:NOTES:END -->
