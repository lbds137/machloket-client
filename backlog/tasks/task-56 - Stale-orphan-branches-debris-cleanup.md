---
id: TASK-56
title: Stale/orphan branches + debris cleanup
status: Done
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-27T20:57:00Z'
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

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-11-27T20:57:00Z

---

DONE 11-27 (owner-approved batch). (a) The 9 fix/* branches deleted: each tip verified == its MERGED PR head (checkbox-disabled-readonly=#121, full-storage-2=#136, full-storage-boot=#134, landing-defaults=#135, landing-first-paint=#128, landing-follow-ups=#129, landing-lows=#130, u4c-accept-landing-throw=#125, u4d-invite-quota-landing=#126) before git branch -D. (b) Orphans deleted: worktree-agent-a02dd39436d2e5b96 + a41c5d27a01bc92af (ancestor=Y verified), worktree-agent-uup1 (tip tree-delta 0 vs main... corrected: ancestor check Y + merged content). 7 stale unit worktrees (mc-t18/t19/t6, task135/149/169/179) removed via safe-worktree-clean apply-hold, every reason class "ignored", backed up under ~/.local/state/seyag/worktree-backups/2026-11-27T15*; wt-embargo KEPT on owner ruling (standing embargo/security surface). (c) fs4r1 logs: done 11-19. Evidence note: a first measurement pass ran the diffs against bare ref names that do not exist (TASK-56 listed the fix/* branches without their prefix) and reported hollow zeros; caught when the deletions came back "not found"; re-measured on the real refs (PR-head equality) before deleting. Owner yes: AskUserQuestion 11-27 15:5x, "Delete all 12".

---
<!-- COMMENTS:END -->
