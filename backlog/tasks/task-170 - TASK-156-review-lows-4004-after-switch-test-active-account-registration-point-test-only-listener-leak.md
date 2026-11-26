---
id: TASK-170
title: >-
  TASK-156 review lows: 4004-after-switch test, active-account registration
  point, test-only listener leak
status: Done
assignee: []
created_date: '2026-11-26T01:50:00Z'
updated_date: '2026-11-26T17:34:00Z'
labels:
  - auth
  - test
dependencies: []
priority: low
ordinal: 101920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From claude-review on PR #220 (TASK-156), all low. (1) No test covers the gateway 4004 entry (src/webpage/localuser.ts gatewayAuthFailed -> handleUnauthorized) after an account switch; add one: B's 4004 while A's probe is held. (2) noteActiveAccount runs near the top of the Localuser constructor; if a later constructor step throws at boot (index.ts falls back to new Localuser(-1)), the failed account stays registered active. Decide: register at the end of a successful construction, or from showAccountSwitcher + the index boot path. (3) The TASK-156 tests in src/webpage/apiFetch.test.ts call new Localuser(b), whose SW.captureEvent and onCookieSessionAdopted registrations are never torn down; prefer noteActiveAccount(b.uid) directly plus one constructor-registers assertion.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #230 (merged 2026-11-26 17:33 UTC). Review PASS; its lows 1-2 ride the next auth PR (role file), low 3 noted on TASK-183.
<!-- SECTION:NOTES:END -->
