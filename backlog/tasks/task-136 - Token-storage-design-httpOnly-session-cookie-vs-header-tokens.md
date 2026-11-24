---
id: TASK-136
title: 'Token storage design: httpOnly session cookie vs header tokens'
status: To Do
assignee: []
created_date: '2026-11-24T18:11:00Z'
updated_date: '2026-11-24T18:25:00Z'
labels:
  - security-hardening
  - design
  - server-joint
dependencies: []
priority: high
ordinal: 67920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design task, joint with Machloket Server; Lila's call (via Deck 11-24). Account tokens are kept in localStorage userinfos (utils.ts ~387, settingOverlay.ts ~123) and the session-only copy in sessionStorage. Options: browser sessions on a same-site deployment use an httpOnly cookie the server issues; header tokens stay for cross-instance accounts and bots. Trade-off: multi-instance support (a cookie only covers the deployment's own instance). Until decided, the related CodeQL clear-text-storage dismissals are accepted risk pending this task and TASK-135, not 'by design'. Re-grep the named lines at unit time.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-24 Product decision (Lila, relayed by Deck at 13:24; decision-9): ours first, others best-effort. Design target: same-site cookie login on our own deployment; header tokens stay for other instances and bots; picker and discovery stay; no new stock-Spacebar workarounds.
<!-- SECTION:NOTES:END -->
