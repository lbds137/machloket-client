---
id: TASK-176
title: >-
  PR 222 review lows: 2FA re-submit mode, probe-order guard, register release
  test
status: Done
assignee: []
created_date: '2026-11-26T04:00:00Z'
updated_date: '2026-11-26T05:19:00Z'
labels:
  - auth
  - tests
dependencies: []
priority: low
ordinal: 107920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From claude-review of PR #222 (TASK-163), VERDICT PASS. (1) A re-submit of the same login form while its first submit waits on a second factor finds the form's own cookie-login hold taken and logs in by token: designed behaviour for concurrent logins, but a quiet mode change for one user retrying one form. Check whether the 2FA dialog leaves the login form submittable; if so, comment it or block the re-submit. (2) retryPendingLogout's probe-before-read order (cookieLoginInFlight before readStoredAccounts) has no test; the window isn't reachable through current seams. Add a seam-based test if one appears, else name the ordering constraint in the comment more bluntly. (3) Only login is tested for releasing the hold on a refused submit; add the same case for register (shares addCookieOptIn). Trigger: the next unit touching addCookieOptIn / retryPendingLogout (the no-Web-Locks follow-up qualifies).
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped in PR #223 (79ae0c7): cookie login, the logout retry and the migration fail closed to token without Web Locks; the 2FA re-submit is documented as by-design token login, the probe-before-read order is stated bluntly, and a register test pins the hold's release on a refused submit.
<!-- SECTION:FINAL_SUMMARY:END -->
