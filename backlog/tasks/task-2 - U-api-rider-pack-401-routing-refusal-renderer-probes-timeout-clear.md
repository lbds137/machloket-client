---
id: TASK-2
title: 'U-api rider pack: 401 routing, refusal renderer, probes, timeout clear'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-22T21:49:00Z'
labels:
  - u-api
  - deferred
dependencies: []
priority: medium
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
(j) 2e council review (PR #173): handleUnauthorized's navigation microtask (carryAccountsAcrossNavigation + pageNav.go in queueMicrotask, src/webpage/utils/apiFetch.ts) runs outside the try/catch, so a throw there leaves unauthorizedNavPending stuck true; put the whole probe->invalidate->navigate flow under one boundary and decide the state when invalidation succeeded but navigation threw.
(k) Specialuser.logout (src/webpage/utils/utils.ts) treats a 401 as a failure: a dead token retries 3 times, then shows the logout-error dialog before continue removes the account. A 401 from /auth/logout means the token is already dead; treat it as done (local removal) and skip the dialog. User-visible: confirm the copy/flow before changing.
(l) Same review, on (h): per-token probe dedup + re-check the active account before routing (a 401 for token B is dropped while token A's probe is in flight).

(m) PR #173 claude-review: timeoutMs:0 (saveProfile, exportUserData) means a server that never sends headers hangs the save/export forever (same as the old raw fetch); add a headers-only budget to apiFetch (e.g. headersTimeoutMs) so large bodies still stream.
(n) Same review, on (l): bot-token 401s (src/webpage/bot.ts guild list/leave) now start a /users/@me probe that holds the shared latch up to 10 s; invalidateAccount matches nothing, so the outcome is right, but a real user-token 401 in that window is absorbed.
(o) Test gap: getApiUrlsV1's two discoveryJson sites (/.well-known/spacebar, /policies/instance/domains) have no hang/fallback-within-budget pin; RED B covers only V2.
(p) Style: discoveryJson returns Promise<any>; narrow to Promise<unknown> at its three callers.
<!-- SECTION:NOTES:END -->
