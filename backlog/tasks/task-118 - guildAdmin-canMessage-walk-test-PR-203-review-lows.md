---
id: TASK-118
title: 'guildAdmin canMessage walk test: PR #203 review lows'
status: To Do
assignee: []
created_date: '2026-11-24T13:54:00Z'
labels:
  - tests
dependencies: []
priority: low
ordinal: 49920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the claude-review PASS on PR #203 (TASK-108), both low, in src/webpage/guildAdmin.test.ts ('reading whether a member can message'): (1) the fixture comment says every step of the walk decides something, but for the text channel's SEND_MESSAGES removing the @everyone deny or the Mod deny gives the same true (the role grant or Helper's allow still carries it); narrow the comment or the fixture. (2) the bits helper doesn't guard an unknown permission name: indexOf -1 makes 1n << BigInt(-1) = 0n, so a typo grants/denies nothing silently; throw on -1 like Permissions.getPermission (permissions.ts:152-156). Re-grep anchors at unit time.
<!-- SECTION:DESCRIPTION:END -->
