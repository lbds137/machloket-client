---
id: TASK-165
title: 'Cookie migration: test the exchange''s 403, 409 and 5xx answers'
status: To Do
assignee: []
created_date: '2026-11-25T22:47:00Z'
labels:
  - auth
  - tests
dependencies: []
priority: low
ordinal: 96920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the claude-review of PR #217 (TASK-150), low. cookieMigration.test.ts covers the exchange's 204, 401 and no-answer cases; 403, 409 and 5xx, which must all keep the header account, have no test. Add one parameterised case pinning 'any other answer keeps the token'.
<!-- SECTION:DESCRIPTION:END -->
