---
id: TASK-131
title: App refresh buttons sign session-only accounts out
status: To Do
assignee: []
created_date: '2026-11-24T16:14:00Z'
labels:
  - accounts
  - ux
dependencies: []
priority: low
ordinal: 62920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three reloads the user starts from the app drop accounts signed in for this session only, with no warning: the update icon (src/webpage/index.ts:~829), 'Refresh page' after an update check (localuser.ts:~4686), and the clear-cache action (localuser.ts:~4980, reload(true)). The Dialog says a reload ends these accounts, but these are the app's own buttons. Product call first: keep the accounts (route through pageNav.go to the same URL, which carries them) or warn before refreshing. navigationGuard.test.ts lists the three as the allowed reloads; update that list with the fix. Found in TASK-6's review.
<!-- SECTION:DESCRIPTION:END -->
