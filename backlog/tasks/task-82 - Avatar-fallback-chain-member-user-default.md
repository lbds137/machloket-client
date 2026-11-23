---
id: TASK-82
title: 'Avatar fallback chain: member -> user -> default'
status: To Do
assignee: []
created_date: '2026-11-23T00:09:00Z'
labels:
  - parity
  - media
dependencies: []
priority: low
ordinal: 13920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From PR #174 claude-review (round 2, low). A broken guild-member avatar falls back straight to the default avatar (src/webpage/user.ts buildpfp, TASK-78). It never tries the user's own global avatar, which is what Discord shows for a member with no member avatar. That's a parity gap for stale member avatars, which the server's delete-on-delete set (TASK-78) doesn't cover. Do: when a member-avatar source fails, try this.getpfpsrc() (the global avatar) before defaultAvatarSrc(). Red-first test: member src fails, then the user src is applied, and when that fails too, the default is applied.
<!-- SECTION:DESCRIPTION:END -->
