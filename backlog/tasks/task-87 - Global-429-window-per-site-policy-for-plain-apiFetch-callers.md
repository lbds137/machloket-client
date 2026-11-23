---
id: TASK-87
title: 'Global 429 window: per-site policy for plain apiFetch callers'
status: To Do
assignee: []
created_date: '2026-11-23T03:35:00Z'
labels:
  - u-api
dependencies: []
priority: low
ordinal: 18920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deferred from TASK-5 (C8) review round 1. After TASK-5, apiFetch ARMS the shared 429 window on every 429, but only fetchRetryOnce, the history pager/re-ask and the message send WAIT on it; the ~140 plain apiFetch sites still send into an armed window (global or route) and surface the 429 as a refusal. Ruled for TASK-5: making every site silently wait would hold UI actions with no feedback. Trigger to promote: a report of 429 bursts from plain apiFetch sites, or the server error-limiter fix (server TASK-250) making global windows common. Shape when promoted: an explicit per-site policy (wait / fail fast with a rate-limited refusal / skip), not a blanket wait in apiFetch.
<!-- SECTION:DESCRIPTION:END -->
