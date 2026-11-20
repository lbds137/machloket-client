---
id: TASK-5
title: 'U-api batch 2f (C8): unify the 429 cooldown maps'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:37:00Z'
labels:
  - u-api
dependencies: []
priority: medium
ordinal: 140
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
C8 from the REST-contract review: 429 cooldown/window state lives in several maps (history window, send-XHR resend, typing, form). Unify through `src/webpage/utils/rateLimit.ts` so one armed window is shared per instance; the send+slowmode distinction (slowmode `code: 20016` reported under a 429 status takes the countdown, never retries) must survive the unification. After the site migration batches.
<!-- SECTION:DESCRIPTION:END -->
