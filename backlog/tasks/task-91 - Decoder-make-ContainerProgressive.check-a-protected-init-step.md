---
id: TASK-91
title: 'Decoder: make ContainerProgressive.check() a protected init step'
status: To Do
assignee: []
created_date: '2026-11-23T15:19:00Z'
updated_date: '2026-11-23T16:44:00Z'
labels:
  - u-api
dependencies: []
priority: low
ordinal: 22920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the TASK-90 council review (2026-11-23): check() in src/webpage/utils/progessiveLoad.ts (ContainerProgressive) is public and reads the stream directly, outside settle()/failOn(), so a call after a failure or mid-read would bypass the failure latch and the owed delimiter. Only make() calls it today (git grep '.check()' found no outside caller). Make it protected (or fold it into make()). Trigger: next decoder unit.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From PR #184 review (Low): rename the private ContainerProgressive.close() (marks the container done) to markDone() or similar, so it is not confused with ProgressiveArray.close() used as list.prog.close() (guild.ts). Do it in the same pass as the check() change.
<!-- SECTION:NOTES:END -->
