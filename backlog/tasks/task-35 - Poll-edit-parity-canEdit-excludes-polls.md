---
id: TASK-35
title: 'Poll edit parity: canEdit excludes polls'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - parity
  - deferred
dependencies: []
ordinal: 560
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
canEdit (message.ts ~238) has no poll exclusion, so our client offers Edit on own poll messages; Discord hides Edit on polls entirely (code-read both sides). The emptied-edit branch already routes to save (server answers), nothing regressed; the gap is the editor opening at all. Fix: exclude this.poll from canEdit (verify against the mock poll fixture + a real instance first). Trigger: next canEdit touch or a polls parity pass.
<!-- SECTION:DESCRIPTION:END -->
