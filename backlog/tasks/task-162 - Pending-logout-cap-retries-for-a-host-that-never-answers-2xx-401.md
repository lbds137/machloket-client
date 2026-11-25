---
id: TASK-162
title: 'Pending logout: cap retries for a host that never answers 2xx/401'
status: To Do
assignee: []
created_date: '2026-11-25T21:10:00Z'
labels:
  - auth
dependencies: []
ordinal: 93920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #216 review: a pending logout stays until a 2xx or 401, so an API host gone for good (or always 403/5xx) is retried at every start and stays in cookieModeHosts forever. Add an attempt count or age per entry (store shape change: entry becomes {api, attempts, since}); after the cap, drop it with a console warning. Decide the cap (e.g. 10 starts or 30 days).
<!-- SECTION:DESCRIPTION:END -->
