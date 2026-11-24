---
id: TASK-114
title: markdown.test.ts hostile-input timing test timed out at 20 s in a full gate
status: To Do
assignee: []
created_date: '2026-11-24T13:03:00Z'
labels:
  - tests
  - flake
dependencies: []
priority: low
ordinal: 45920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen 2026-11-24 in the TASK-105 gate (deck-job mc-t105-gate, tree mc-t105, which changes only streamedLists.test.ts). 'parsing hostile or nested input > renders a run of unmatched [, <: or <t: within 3x of plain text of the same length' (src/webpage/markdown.test.ts:157) failed with 'Test timed out in 20000ms', not on its ratio assertion; the unit suite ran 346.87 s. Two agy-worker reviews were running alongside (remote model, local CLI only). Find what part of the test can exceed 20 s under load (iteration count, warm-up, per-run size) and make it bounded; a timing test should fail on its ratio, never on the wall clock. Re-grep the line at unit time.
<!-- SECTION:DESCRIPTION:END -->
