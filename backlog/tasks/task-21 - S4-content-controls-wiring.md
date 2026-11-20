---
id: TASK-21
title: 'S4: content controls wiring'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - settings
dependencies: []
priority: medium
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire the settings spoiler/NSFW selects (shipped with the S2 restructure) to enforcement. Scout: `src/webpage/file.ts` SPOILER_ prefix + reveal path; `src/webpage/channel.ts:4154` nsfwGated — both outside S3's blast radius. Standing settings deferrals: font-scale (own unit), Advanced leaf, Shortcuts leaf.
<!-- SECTION:DESCRIPTION:END -->
