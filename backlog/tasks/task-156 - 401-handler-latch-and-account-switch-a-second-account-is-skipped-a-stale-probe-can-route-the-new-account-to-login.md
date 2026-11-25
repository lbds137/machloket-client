---
id: TASK-156
title: >-
  401 handler latch and account switch: a second account is skipped, a stale
  probe can route the new account to /login
status: To Do
assignee: []
created_date: '2026-11-25T18:39:00Z'
labels:
  - auth
  - bug
dependencies: []
priority: low
ordinal: 87920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the council review of TASK-147 (code-reading; not runtime-confirmed). handleUnauthorized in src/webpage/utils/apiFetch.ts holds one page-wide latch: while account A's probe is out, account B's 401 or gateway 4004 returns early, and with 4004 being terminal B stays on "Unable to connect". Separately, a probe that outlives an account switch still runs invalidateAccount for A (correct) and then pageNav.go("/login") while B is active (wrong). Reproduce red-first first: is either reachable given how an account switch tears down (swapped flag, reload?). If reachable: key the latch by account, and gate the navigation on the probed account still being the active one.
<!-- SECTION:DESCRIPTION:END -->
