---
id: TASK-159
title: 'Login/register: show progress while a pending logout retry holds the submit'
status: To Do
assignee: []
created_date: '2026-11-25T20:24:00Z'
labels:
  - ux
  - auth
dependencies: []
ordinal: 90920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-149 review: Form.submit awaits submitHeaders, which waits on this page's pending-logout run and another tab's cookie-slot lock (up to the API timeout). The form shows no state meanwhile, and a non-FormError there is only console.error'd. Show a busy state and a visible error.
<!-- SECTION:DESCRIPTION:END -->
