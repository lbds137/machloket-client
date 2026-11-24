---
id: TASK-150
title: 'Token storage unit 4: migrate existing own-deployment sessions to the cookie'
status: To Do
assignee: []
created_date: '2026-11-24T22:40:00Z'
labels:
  - security-hardening
  - auth
  - server-joint
dependencies:
  - TASK-148
  - TASK-149
documentation:
  - docs/design/token-storage.md
priority: high
ordinal: 81920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-136 design unit 4 (docs/design/token-storage.md, Sequence 4, "Migrating existing sessions"). Blocked on server TASK-323 (POST /auth/session-cookie). 204 only when the cookie was set; 403/409 leave the header account untouched; refused save and other-tab cases resolved by the cookie probe.
<!-- SECTION:DESCRIPTION:END -->
