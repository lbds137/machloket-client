---
id: TASK-11
title: 'U-r4: per-mention negative cache'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - render
dependencies: []
ordinal: 230
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
R4 LOW/MED perf (render lens): per-mention getUser (`src/webpage/markdown.ts:779`-798); misses are never cached (`src/webpage/localuser.ts:310`-323 finally deletes), so ~600 GETs per render of a message full of unknown mentions, repeated each re-render. Fix: negative cache with TTL + cap distinct resolutions per message (100). Red-first: count fetches.
<!-- SECTION:DESCRIPTION:END -->
