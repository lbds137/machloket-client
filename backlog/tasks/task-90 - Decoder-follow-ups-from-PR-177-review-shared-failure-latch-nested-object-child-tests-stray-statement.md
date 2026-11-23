---
id: TASK-90
title: >-
  Decoder follow-ups from PR #177 review: shared failure latch, nested-object
  child tests, stray statement
status: Done
assignee: []
created_date: '2026-11-23T06:33:00Z'
updated_date: '2026-11-23T16:44:00Z'
labels:
  - u-api
dependencies: []
priority: low
ordinal: 21920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From PR #177 claude-review (TASK-75, merged 642a47eb), all Low. (1) The failure latch (finished setup, failure/fail/failOn, near-identical settle) is duplicated in ArrayProgressive and ObjectProgressive in src/webpage/utils/progessiveLoad.ts; a shared helper would land future fixes once. (2) No test has a nested OBJECT child failing inside a list or object (e.g. [{"a":1;"b":2}]): add a row to the 'a parent read after its nested child failed rejects' it.each in src/webpage/streamedLists.test.ts. (3) Sticky tests check more() after a failure, not getNext()/getNextPair() on a container latched by a CHILD failure; add one. (4) Stray no-op 'Object.entries;' statement near the end of progessiveLoad.ts: delete. Trigger: next bounded implement unit.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #184 (squash a0112f30). claude-review PASS, 2 Lows: (1) private ContainerProgressive.close() reads like prog.close() -> folded into TASK-91 (same class). (2) test Reader type declares both getNext/getNextPair -> ruled out: test-only, a wrong kind fails loudly at runtime; per-kind typing adds generics for no caught bug.
<!-- SECTION:NOTES:END -->
