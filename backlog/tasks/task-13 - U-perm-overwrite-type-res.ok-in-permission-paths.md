---
id: TASK-13
title: 'U-perm: overwrite type + res.ok in permission paths'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels: []
dependencies: []
ordinal: 250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
C4 MED correctness (inherited): overwrite type guessed from userMap (`src/webpage/channel.ts:4991`-4999), channeljson drops type (`src/webpage/jsontypes.ts:631`-635), addRoleToPerms (`src/webpage/channel.ts:4974`) ignores res.ok. Fix: carry type from the server overwrite; check ok before local mutation. Red-first.

(Line anchors may drift — re-grep the named file at unit time.)
<!-- SECTION:DESCRIPTION:END -->
