---
id: TASK-56
title: Stale/orphan branches + debris cleanup
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:39:00Z'
labels:
  - cleanup
dependencies: []
priority: low
ordinal: 770
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
(a) Nine local fix/* branches with no worktree (checkbox-disabled-readonly, full-storage-2, full-storage-boot, landing-defaults, landing-first-paint, landing-follow-ups, landing-lows, u4c-accept-landing-throw, u4d-invite-quota-landing): none proven ancestor of origin/main. Per branch: tree-diff its touched paths vs origin/main + match its PR state, then one owner yes/no.
(b) Orphan worktree-agent-* branches (a02dd39436d2e5b96, a41c5d27a01bc92af, uup1) — no worktree, unjudged; check merged state before any delete; deletion needs the owner's yes.
(c) fs4r1-*.log debris — DONE: the 11 files were deleted 11-19 on the owner's direct confirm through the ask tool.
<!-- SECTION:DESCRIPTION:END -->
