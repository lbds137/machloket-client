---
id: TASK-48
title: safeLink internal rewrite origin check (verify)
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - probe-first
  - deferred
dependencies: []
priority: medium
ordinal: 690
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify the shipped safeLink rewrite hardening (4dbed87c, on main) fully covers the internal channel-link rewrite surface — the fix requires the client's or the instance's origin for internal links. Re-verify at the next safeLink/linkSafety touch.
<!-- SECTION:DESCRIPTION:END -->
