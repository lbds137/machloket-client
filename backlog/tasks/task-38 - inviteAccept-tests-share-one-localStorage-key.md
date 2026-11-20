---
id: TASK-38
title: inviteAccept tests share one localStorage key
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - test-robustness
  - deferred
dependencies: []
ordinal: 590
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The /invite page tests set/remove the shared userinfos localStorage key around importing invite.ts; if the Vitest browser runner runs files concurrently (vite.config.js sets no fileParallelism), one file's afterAll could land inside another's setItem/import window. Not verified whether files run concurrently. Trigger: any flake in those files — check runner concurrency first, then per-file distinct keys or fileParallelism:false.
<!-- SECTION:DESCRIPTION:END -->
