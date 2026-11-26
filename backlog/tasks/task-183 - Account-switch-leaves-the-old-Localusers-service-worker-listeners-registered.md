---
id: TASK-183
title: Account switch leaves the old Localuser's service-worker listeners registered
status: In Progress
assignee: []
created_date: '2026-11-26T16:56:00Z'
updated_date: '2026-11-26T23:28:00Z'
labels:
  - auth
  - leak
dependencies: []
priority: medium
ordinal: 114920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-170. The Localuser constructor registers SW.captureEvent('refreshURL', ...) (src/webpage/localuser.ts constructor); Localuser.unload never calls SW.uncaptureEvent. After each showAccountSwitcher switch, the swapped-out Localuser stays reachable from SW.eventListeners (a leak per switch), and a refreshURL message from the service worker is answered by every instance constructed on the page, each posting its own refreshedUrl (a swapped-out account's refreshURL runs too). (traceSub registers a 'trace' listener the same way but has no caller today: git grep 'traceSub()' finds only its definition.) Fix: keep the listener reference on the instance and uncapture it in unload (or when swapped); test that a switch leaves exactly one refreshURL listener.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From the PR #230 review: once uncapture exists, switch the apiFetch.test.ts afterEach (TASK-156 describe) from editing SW.eventListeners directly to the new uncapture path.
<!-- SECTION:NOTES:END -->
