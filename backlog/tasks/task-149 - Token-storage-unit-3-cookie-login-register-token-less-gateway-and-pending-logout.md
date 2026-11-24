---
id: TASK-149
title: >-
  Token storage unit 3: cookie login, register, token-less gateway and pending
  logout
status: To Do
assignee: []
created_date: '2026-11-24T22:40:00Z'
labels:
  - security-hardening
  - auth
  - server-joint
dependencies:
  - TASK-148
documentation:
  - docs/design/token-storage.md
priority: high
ordinal: 80920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-136 design unit 3 (docs/design/token-storage.md, Sequence 3). Blocked on the server: its TASK-313 (origins, CORS, CSRF), TASK-321 (issuance, reading, authCookie discovery) and TASK-322 (gateway) must be deployed first. Opt-in on login, register and both MFA steps when discovery says authCookie and no logged-in cookie account exists on the host; body auth_mode decides; token-less Identify and Resume; pending logout (cookie account only, dropped when a logged-in cookie account exists, checked before the retry). This unit is what removes the own-deployment token from page script.
<!-- SECTION:DESCRIPTION:END -->
