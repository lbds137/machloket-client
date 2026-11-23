---
id: TASK-95
title: Ban list's failure line can render a task before the bans that arrived
status: To Do
assignee: []
created_date: '2026-11-23T18:10:00Z'
labels:
  - ui
dependencies: []
priority: low
ordinal: 26920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen during TASK-94 (2026-11-23, MutationObserver probe on a ban list whose body errors right after the first item): the pane's order of states was '-+line' then 'alice+line', i.e. the 'That didn't go through (offline)' line showed one task before the row above it. Cause by code reading: makeBanList (src/webpage/guild.ts, loadArr) appends rows from a zero-delay setTimeout (addHTML) while failure.show(stopped) runs as soon as streamList returns. End state is correct; the gap is one task (could paint one frame of the line under an empty list). The invites pane renders synchronously before failure.show, so it doesn't have this. Fix shape: flush pending rows (bansArr2) before failure.show. Trigger: next touch of makeBanList or the streamed-list panes.
<!-- SECTION:DESCRIPTION:END -->
