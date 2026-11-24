---
id: TASK-123
title: 'Channel overwrites: PR #204 review lows (type union, record sent type)'
status: To Do
assignee: []
created_date: '2026-11-24T14:48:00Z'
labels:
  - cleanup
dependencies: []
priority: low
ordinal: 54920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the claude-review PASS on PR #204 (TASK-13), both low: (1) jsontypes.ts declares the overwrite's type as number and Channel.overwriteTypes is Map<string, number>; a 0 | 1 | 2 alias (OverwriteType) would let TypeScript check the contract (keep setOverwrites' runtime check: server JSON is untrusted). (2) updateRolePermissions doesn't record the type it sent for a NEW id in overwriteTypes (the permission_overwrites local insert is also still commented out); CHANNEL_UPDATE refreshes both and the fallback gives the same answer, so nothing is wrong today. If the local insert is ever re-enabled, record the type with it. Re-grep anchors at unit time.
<!-- SECTION:DESCRIPTION:END -->
