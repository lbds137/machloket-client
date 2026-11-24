---
id: TASK-145
title: >-
  Store rotated tokens: TOTP enable/disable and password change drop the token
  they return
status: To Do
assignee: []
created_date: '2026-11-24T21:14:00Z'
updated_date: '2026-11-24T21:54:00Z'
labels:
  - bug
  - auth
dependencies: []
priority: low
ordinal: 76920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in the TASK-136 design survey (docs/design/token-storage.md, Found work). The TOTP disable form (src/webpage/localuser.ts ~3889), the TOTP enable form (~3915) and the password change PATCH /users/@me (~4244) ignore the token in the response (newToken for the password change). Per Server (2026-11-24, from its code; see notes), a header session's old session stays valid on all three, so the account is NOT logged out: the cost is an unused live session left on the server per TOTP rotation (a password change ends every other session; whether its newToken leaves a second live session is unknown). Not runtime-confirmed: confirm on the real-server tier first (red-first), then store the rotated token for header accounts, never writing an absent token over a stored one. Sequence step 2 of the design.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Update 2026-11-24 16:15 (Machloket Server, answering the TASK-136 questions from its code): TOTP enable/disable mint a new session and leave the caller's old session alive; a password change ends every OTHER session. So the dropped token does not log the user out; the likely cost is an unused live session per TOTP rotation. Re-scoped: confirm on the real-server tier first, then decide store-the-rotated-token vs. leave. Not runtime-confirmed.
<!-- SECTION:NOTES:END -->
