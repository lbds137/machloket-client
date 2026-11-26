---
id: TASK-174
title: Gateway Retry button appears without focus or a screen-reader announcement
status: To Do
assignee: []
created_date: '2026-11-26T02:39:00Z'
labels:
  - accessibility
dependencies: []
priority: low
ordinal: 105920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the PR #221 (TASK-157) claude-review, low. offerGatewayRetry un-hides #gatewayRetry without moving focus, and #load-desc is not a live region (reviewer's reading; check). A keyboard or screen-reader user isn't told the button exists. Options: focus the button when first shown, or give #load-desc role=status. Coordinate with TASK-172 (new copy for this state) and TASK-171 (splash contrast). Run seyag:accessibility.
<!-- SECTION:DESCRIPTION:END -->
