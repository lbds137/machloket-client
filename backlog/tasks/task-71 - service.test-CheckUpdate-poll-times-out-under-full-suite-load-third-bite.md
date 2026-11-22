---
id: TASK-71
title: service.test CheckUpdate poll times out under full-suite load (third bite)
status: To Do
assignee: []
created_date: '2026-11-22T14:59:00Z'
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
