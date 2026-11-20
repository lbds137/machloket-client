---
id: TASK-60
title: MFA handle2fa dedup pack
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - deferred
dependencies: []
priority: medium
ordinal: 830
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
(a) handle2fa's own challenge parse (settings.ts ~2277) is still unguarded while the handleMfa copy got the try/catch — same dead-form failure mode on a malformed login challenge.
(b) handle2fa derives its URLs from match[0] (bare /api, unversioned — works only if the server aliases /api to /api/vN, unverified in production); the MFA1 flow uses the versioned base — fold into the dedup pass.
(c) The webauthn assertion ceremony is duplicated (handle2fa's arm + handleMfa's) — dedup candidate.
Trigger: next touch of handle2fa or the login 2FA flow.
<!-- SECTION:DESCRIPTION:END -->
