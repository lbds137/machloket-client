---
id: TASK-150
title: 'Token storage unit 4: migrate existing own-deployment sessions to the cookie'
status: In Progress
assignee: []
created_date: '2026-11-24T22:40:00Z'
updated_date: '2026-11-25T22:34:00Z'
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

2026-11-25: implemented (cookieMigration.test.ts; utils migrateToCookieSession / cookieVerdictFor401; apiFetch 401 path; Localuser in-place headers + 4004 reconnect incl. identifiedToken). Server 323 merged (server 915ed8d74), deploy not verified; lands dark (clientOrigins unset on A, [] on B). Reviews: council OpenAI + Mistral (cross-family; agy at cap), real findings fixed red-first; store-wide write lock + live demotion -> private tracker cookie-slot entry; unanswered-probe stop -> TASK-157 note.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-11-25T20:24:00Z

---

From TASK-149: converting a 401 on an own-deployment header account into a cookie probe (instead of the session-expired path) belongs to this unit, with the migration, not to TASK-149.

---
<!-- COMMENTS:END -->
