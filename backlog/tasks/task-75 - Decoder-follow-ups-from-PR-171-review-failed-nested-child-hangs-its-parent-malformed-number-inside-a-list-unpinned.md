---
id: TASK-75
title: >-
  Decoder follow-ups from PR #171 review: failed nested child hangs its parent;
  malformed number inside a list unpinned
status: To Do
assignee: []
created_date: '2026-11-22T19:26:00Z'
labels:
  - u-api
dependencies: []
priority: low
ordinal: 6920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From PR #171 claude-review (TASK-74, merged 8ce679e3), both Low. (1) ArrayProgressive/ObjectProgressive.finished never rejects: if a nested child's read throws (SyntaxError inside an item), a later parent.more()/getNext() awaits owed.child.finished forever (a promise wait, so the idle budget never fires). streamList can't reach it (it returns on the child's error), but the class doc promises later calls reject instead of hanging. Fix: reject a failed signal on child failure and race it against finished in settle() (red-first: parent.more() after a failed child must reject within 200 ms), or document the contract. (2) Malformed numbers are pinned only as the top-level value; add a streamList row with a malformed number inside an invite (e.g. {"uses": 01}) showing listUnreadable, not offline. Trigger: next bounded implement unit.
<!-- SECTION:DESCRIPTION:END -->
