---
id: TASK-66
title: Full-storage rider pack
status: To Do
assignee: []
created_date: '2026-11-19T22:21:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - store
  - deferred
dependencies: []
priority: medium
ordinal: 890
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
- Up to 3 serialise passes per refused proxySave set.
- setPreferences non-boot caller never clears an overlay entry.
- Multi-tab overlay copy on refused writeAccounts.
- Legacy userinfos.preferences.volume 75 never removed.
- Signed-out boot on a full store -> getBulkInfo null at login.
- proxySave rollback leaves a hole on refused array push.
- The e2e isNetwork exemption covers any load error.
- i18n module-load write on a full store (dead in practice).
- READY auth_token rotation accepts any truthy value (typeof string check, localuser.ts:500-503 as of the migration).
- Near-full store: a kept small perminfo value rides in every later account save, so a READY auth_token refresh is never persisted -> next reload starts from a stale token (retry once without the session-only small values, or give the token its own minimal write). Trigger: any stale-token report.
<!-- SECTION:DESCRIPTION:END -->
