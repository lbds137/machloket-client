---
id: TASK-172
title: Dedicated status line while the gateway Retry button shows
status: To Do
assignee: []
created_date: '2026-11-26T02:31:00Z'
labels:
  - ux
  - i18n
dependencies: []
priority: medium
ordinal: 103920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Lila 2026-11-25 (AskUserQuestion): after PR #221 (TASK-157), the loading screen's Retry state gets its own line instead of unableToConnect ('...Please try logging out and back in.'). Chosen wording: 'The instance refused the connection, but your session is still valid. Retry, or switch accounts if it keeps happening.' Caveat to settle at implementation: on an unanswered probe (5xx/429/timeout) validity was not confirmed, so either use the line only after an alive probe or drop 'but your session is still valid' for the unanswered case - user-visible copy, so the split goes back to Lila. Other connection failures keep unableToConnect. Starts after #221 merges (builds on offerGatewayRetry).
<!-- SECTION:DESCRIPTION:END -->
