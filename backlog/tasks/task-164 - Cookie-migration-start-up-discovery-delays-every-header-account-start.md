---
id: TASK-164
title: 'Cookie migration: start-up discovery delays every header-account start'
status: To Do
assignee: []
created_date: '2026-11-25T22:47:00Z'
labels:
  - auth
dependencies: []
priority: low
ordinal: 95920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the claude-review of PR #217 (TASK-150), low. migrateToCookieSession (src/webpage/utils/utils.ts) is awaited in index.ts before the Localuser exists, and runs instance discovery (up to 5 s) on every start of a header account, including instances that never offer cookie sessions; the exchange (up to 10 s) and any slot-lock wait add to that. Code-read, not measured. Measure the start delay on a slow instance first; candidate fixes: skip discovery while a recent stored authCookie=false stands, or run discovery alongside the Localuser start and gate only the exchange.
<!-- SECTION:DESCRIPTION:END -->
