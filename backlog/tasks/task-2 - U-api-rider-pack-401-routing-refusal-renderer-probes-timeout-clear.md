---
id: TASK-2
title: 'U-api rider pack: 401 routing, refusal renderer, probes, timeout clear'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - u-api
  - deferred
dependencies: []
ordinal: 110
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review riders from the #160-#163 rounds, none blocking. Fold into the 2c-2f units or the next apiFetch touch.

(a) 401 /login routing lacks `?redir` and does not skip when already on /login.
(b) One-refusal-renderer completion: discovery bare status (+ the discoveryPaging.test bare-500 pin), commands `n: reason`, inviteLink raw reason, `src/webpage/invite.ts:99` pre-auth landing status-only (decide deliberate-or-not), message.ts:2500 inline status-only Dialog (2d rider).
(c) Real-server probes (redirect:"error" landed on XHR/upload paths): Form.doFetch login redirects; wrong-password-401 shape on delete/disable/TOTP-verify (the client-side probe gate makes it safe).
(d) The 30s timeoutSignal also covers response-body reads and is never cleared — clear on settle.
(e) On 401: switch to another valid stored account or keep a return URL instead of always routing to /login.
(f) invite/template/oauth2 account pickers list accounts marked logged out — filter or mark (`src/webpage/invite.ts:47`, `src/webpage/templatePage.ts:43`, `src/webpage/oauth2/auth.ts:34`).
(g) S3-compatible CDNs 307-redirect upload PUTs — document/handle the redirect:"error" caveat on the channel.ts upload PUT.
(h) Comment riders: latch shared-across-tokens comment; resetUnauthorizedNavForTests comment drift.
(i) CHECK then disposition: the invalidateAccount stale-instance write rider — verify batch 2a's flip-all/save-through-last rework closed it.
<!-- SECTION:DESCRIPTION:END -->
