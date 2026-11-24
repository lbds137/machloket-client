---
id: TASK-150
title: 'Token storage unit 4: migrate existing own-deployment sessions to the cookie'
status: To Do
assignee: []
created_date: '2026-11-24T22:40:00Z'
updated_date: '2026-11-24T22:51:00Z'
labels:
  - security-hardening
  - auth
  - server-joint
  - blocked:server
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-24 BLOCKED on Machloket Server (parked 11-24): server TASK-323 (POST /auth/session-cookie) must be merged and deployed first, plus everything TASK-149 waits on (server 313, 321, 322). Trigger: Server unparks and ships 323.
<!-- SECTION:NOTES:END -->
