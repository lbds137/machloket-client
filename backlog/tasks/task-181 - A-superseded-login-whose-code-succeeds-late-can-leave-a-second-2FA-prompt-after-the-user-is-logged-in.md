---
id: TASK-181
title: >-
  A superseded login whose code succeeds late can leave a second 2FA prompt
  after the user is logged in
status: To Do
assignee: []
created_date: '2026-11-26T15:59:00Z'
labels:
  - auth
dependencies: []
priority: low
ordinal: 112920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review low 3 on PR #228 (user-visible). A re-submit while the first submit's 2FA code is on the wire goes out by token; if the first code then succeeds, the user is logged in (cookie) while the re-submit may still raise its own 2FA prompt and a second login. Documented as the same rule as two forms' logins (cookieOptIn doc in src/webpage/utils/utils.ts). Decide whether a late success should cancel the re-submit's prompts.
<!-- SECTION:DESCRIPTION:END -->
