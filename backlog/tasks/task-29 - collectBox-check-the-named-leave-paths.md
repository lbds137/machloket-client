---
id: TASK-29
title: 'collectBox: check the named leave-paths'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - probe-first
dependencies: []
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reviewer-inferred claim (11-02): paths that leave with no channel focused skip collectBox — named sites `src/webpage/guild.ts:2555`, `src/webpage/localuser.ts:470`/:539/:2099; waiting files would drop on the next channel open. The home-page trip test passes, so that path keeps them. Check each named site with an e2e case before treating it as a bug.

(Line anchors may drift — re-grep the named file at unit time.)
<!-- SECTION:DESCRIPTION:END -->
