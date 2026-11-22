---
id: TASK-76
title: 'Uncalled Fermo methods: Member.highInfo and Channel.addRoleToPerms'
status: To Do
assignee: []
created_date: '2026-11-22T19:53:00Z'
labels:
  - cleanup
dependencies: []
priority: low
ordinal: 7920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in TASK-3 (U-api 2d). Neither has a production caller: grep of src for highInfo/addRoleToPerms/RoleToPerms (positive control: user.ts:1928 matches User.highInfo; Member extends SnowFlake, not User). guildAdmin.test.ts stubs addRoleToPerms only to assert it is NOT called. addRoleToPerms also ignores res.ok (a refused PUT still writes the local overwrite) and Member.highInfo .json()s a refusal body. TASK-3 swaps both to apiFetch mechanically. Disposition to decide: delete both (and the guildAdmin stub), or wire + fix if a Discord-parity caller is planned. Re-grep at unit time.
<!-- SECTION:DESCRIPTION:END -->
