---
id: TASK-145
title: >-
  Store rotated tokens: TOTP enable/disable and password change drop the token
  they return
status: To Do
assignee: []
created_date: '2026-11-24T21:14:00Z'
labels:
  - bug
  - auth
dependencies: []
priority: medium
ordinal: 76920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in the TASK-136 design survey (docs/design/token-storage.md, Found work). The TOTP disable form (src/webpage/localuser.ts ~3889), the TOTP enable form (~3915) and the password change PATCH /users/@me (~4244) ignore the token in the response (newToken for the password change). If the server invalidates the old token on these rotations, the account is logged out at its next 401. Code-reading only; not runtime-confirmed: confirm on the real-server tier first (red-first), then store the rotated token for header accounts, never writing an absent token over a stored one. Sequence step 2 of the design.
<!-- SECTION:DESCRIPTION:END -->
