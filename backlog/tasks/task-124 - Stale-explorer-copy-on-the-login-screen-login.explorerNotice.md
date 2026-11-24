---
id: TASK-124
title: Stale explorer copy on the login screen (login.explorerNotice)
status: To Do
assignee: []
created_date: '2026-11-24T15:29:00Z'
labels:
  - branding
  - copy
dependencies: []
priority: low
ordinal: 55920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
login.ts:83 shows I18n.login.explorerNotice: 'If you have created an account on the explorer, log in with the same credentials…'. The client stopped reading the Spacebar Explorer catalog (instances come from public/instances.json only, utils.ts LocalInstance comment), and TASK-18 removes the bot catalog, so nothing in the app is 'the explorer' any more. Decide: drop the notice, or reword it (Spacebar credentials are per instance). Found while doing TASK-18.
<!-- SECTION:DESCRIPTION:END -->
