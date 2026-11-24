---
id: TASK-117
title: 'Channel permissions list: a deleted role''s overwrite is looked up as a user'
status: To Do
assignee: []
created_date: '2026-11-24T13:46:00Z'
labels:
  - permissions
dependencies: []
priority: low
ordinal: 48920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-13. Channel.getOverwrites (src/webpage/channel.ts ~123-130) classifies each overwrite as a role when guild.roleids has its id and otherwise calls localuser.getUser(id). An overwrite whose role was deleted (server type 0) is then fetched as a user. Code-reading suggests a broken or missing row in the channel's permission settings list; not runtime-confirmed. After TASK-13, Channel.overwriteTypes holds the server's type per overwrite, so the classification can read it (type 0 with no role: show it as a deleted role, or let the owner remove it) instead of guessing. Check what Discord shows for a deleted role's lingering overwrite before choosing the display.
<!-- SECTION:DESCRIPTION:END -->
