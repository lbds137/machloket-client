---
id: TASK-163
title: 'Cookie login: post-merge review lows from PR #216'
status: Done
assignee: []
created_date: '2026-11-25T21:37:00Z'
updated_date: '2026-11-26T04:23:00Z'
labels:
  - auth
  - tests
dependencies: []
priority: low
ordinal: 94920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final claude-review on PR #216 (all low):
1. Cross-tab race: tab A's cookie login is in flight (lock released before the request) while tab B starts and retries the host's surviving pending logout; if A's Set-Cookie landed first, B ends A's new session (forced re-login, no leak). Fix: a login-in-progress marker the retry skips, or at least document it in docs/design/token-storage.md and the cookieOptInHeaders docblock.
2. adduser's pendingLogouts delete loop drops a FAILED retry's entry when a cookie login follows: the old server-side session lives until expiry (unusable: the cookie was overwritten). Say so in the comment, or keep the entry for a bodyless retry.
3. cookieLogin.test.ts describe blocks named 'review round 1' / 'review round 3 (PR #216)': move the cases into the behaviour groups.
4. e2e/cookie-login.spec.ts: assert x-machloket-csrf: 1 on a post-login API request (proves REST goes with credentials).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #222 (merge ed7335bd): exclusive cookie-login hold until submit settles; retry probes the hold before reading the store; adduser drop commented; tests regrouped; e2e CSRF asserts. Review lows → TASK-176. Store-wide RMW → TASK-175.
<!-- SECTION:NOTES:END -->
