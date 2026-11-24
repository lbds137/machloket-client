---
id: TASK-147
title: >-
  Gateway close 4004 (auth failed) ends at Unable to connect instead of the 401
  path
status: To Do
assignee: []
created_date: '2026-11-24T21:26:00Z'
labels:
  - bug
  - auth
dependencies: []
priority: medium
ordinal: 78920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in the TASK-136 design review. 4004 is not in wsCodesRetry (src/webpage/localuser.ts ~129) and localuser.ts has no 4004 handling (git grep), so by code-reading an account whose token died while it was closed boots to "Unable to connect" (~919) instead of the verified-401 path (probe, then /login). Not runtime-confirmed: reproduce red-first on the mock tier (gateway closes 4004). Applies to header accounts today; TASK-136 cookie accounts depend on it (design doc, Gateway).
<!-- SECTION:DESCRIPTION:END -->
