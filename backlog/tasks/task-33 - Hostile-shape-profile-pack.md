---
id: TASK-33
title: Hostile-shape profile pack
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - deferred
dependencies: []
priority: medium
ordinal: 540
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
- A null mutual_guilds element crashes the profile IIFE (user.ts:1926; loop untouched by the guards unit).
- mutual_friends [null] twin (user.ts:1973) — fix together.
- Non-callable toString class: {"toString":0} throws at string coercion in server-string sinks (instance info, connection name/external_id/created_at, counts) — unconfirmed at runtime.
- avatar_decoration_data.asset non-string throws buildpfp for ANY user payload.
- userupdate copies wrong-typed fields onto a cached User (user.ts:1030-1050), so later buildpfp/createWidget throw (member list, message author, DM list) — fix at the type boundary (validate in userupdate / typeof asset check in buildpfp).
- instanceName non-string -> "undefined" title (localuser.ts:5141 — skip, don't refuse); instance-info non-string truthy tosPage/publicUrl/frontPage/correspondenceEmail draw "[object Object]" (~5142-5152).
- member.ts ~477 Member.highInfo is dormant (no callers) — adopt user.ts's guards or delete it on next touch.
Trigger: hostile-instance hardening pass / profile-shape sweep / next userupdate touch.
<!-- SECTION:DESCRIPTION:END -->
