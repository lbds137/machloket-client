---
id: TASK-9
title: 'U-gw3: gateway compression default + zlib handling'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - gateway
dependencies: []
priority: low
ordinal: 210
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
G4/G10 from gateway review 2. Known anchor: `src/webpage/devSettings.ts:6` default true plus the `!` gate at `src/webpage/localuser.ts:637` leaves compression OFF despite support; sweep the zlib path handling in the same unit.
<!-- SECTION:DESCRIPTION:END -->
