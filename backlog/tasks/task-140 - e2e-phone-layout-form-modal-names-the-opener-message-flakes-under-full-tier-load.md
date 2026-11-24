---
id: TASK-140
title: >-
  e2e phone-layout 'form modal names the opener message' flakes under full-tier
  load
status: To Do
assignee: []
created_date: '2026-11-24T20:01:00Z'
updated_date: '2026-11-24T20:01:00Z'
labels:
  - e2e
  - flake
dependencies: []
priority: low
ordinal: 71920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
phone-layout.spec.ts:94 timed out in openModalViaButton (e2e/fixtures.ts, its 5 s predicate) in a full mock-tier run on 2026-11-24 (job mc-t135-gate, PR #210's branch, unrelated code); it passed 3/3 run alone. A load-timing flake, a sibling of TASK-59 and TASK-112 (read their fixes first). Re-grep the line numbers at unit time.
<!-- SECTION:DESCRIPTION:END -->
