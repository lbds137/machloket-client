---
id: TASK-68
title: Drain rider pack (C/P families)
status: To Do
assignee: []
created_date: '2026-11-19T22:21:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - deferred
dependencies: []
priority: medium
ordinal: 910
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
- C7: acceptInvite matches "already a member" by an English regex (acceptInvite.ts:27) — a translated/stock message means refusal instead of opening the guild; stable server code + regex fallback (server ask rides the same relay).
- C6-client + openapi shapes: instance config typed as Object, member counts {} — server artifacts, relayed; client tolerates both shapes.
- C10: request bodies rely on ajv coerceTypes (inviteLink.ts:20 max_age string; message.ts:1900-1903 poll answer_ids numbers) — send schema types.
- R10: embed color:null (embed.ts:108-111) + missing component arrays (compontents.ts:129/250-251/276) throw -> whole message dropped; per-embed/component try/catch + typeof color === "number".
- R11: embed.ts:355 src "undefined" without a thumbnail proxy_url; compontents.ts:408 impossible range check; links activate on mouseup (drag-select opens the dialog); markdown.ts:1017 bracket rule.
- P10: userPreferences fields unvalidated (a non-array notification sound throws localuser.ts:3453) — per-field coercion.
- P11: the instance ping is cached forever in userinfos.instances (localuser.ts:7134) — fetchedAt + TTL.
Trigger: next touch of each file.
<!-- SECTION:DESCRIPTION:END -->
