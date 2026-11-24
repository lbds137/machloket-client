---
id: TASK-125
title: Session-only Dialog repeats after an in-app hop that restarts the app
status: To Do
assignee: []
created_date: '2026-11-24T16:01:00Z'
labels:
  - accounts
  - ux
dependencies: []
priority: low
ordinal: 56920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The 'signed in for this session only' Dialog is remembered per page (notifiedThisSession, src/webpage/utils/storage/settingOverlay.ts), and the app's boot shows it whenever it starts a session-only account from a hand-off (src/webpage/index.ts, handedOff && !isAccountStored). So any in-app hop that restarts the app on a session-only account shows it again: the switcher's logout of the current account (pageNav.go('/channels/@me'), utils/switcher.ts:83) or an add-account round trip. Code-read; the login->app hop in e2e/full-storage-login.spec.ts shows the boot notifying after a page change. Product call first: tell once per tab until a reload, or once per account? Then red-first (e2e counting dialogs over two hops). Found in TASK-6's review.
<!-- SECTION:DESCRIPTION:END -->
