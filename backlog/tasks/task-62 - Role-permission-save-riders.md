---
id: TASK-62
title: Role/permission save riders
status: To Do
assignee: []
created_date: '2026-11-19T22:21:00Z'
labels:
  - deferred
dependencies: []
ordinal: 850
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
(a) "Sync permissions": Promise.all resolves on HTTP errors and the success dialog shows unconditionally — a fully-refused sync reports success (channel.ts ~688-700).
(b) Context-menu role creation ignores the POST's response — a refused create shows nothing (role.ts ~709-717).
(c) After a refused save the toggles still show the refused bits until the role is reopened (optional polish).
(d) guild.ts ~460 role-members list: Promise.all over Member.new — one refused member rejects the whole list.
Trigger: next permissions/role UI touch.
<!-- SECTION:DESCRIPTION:END -->
