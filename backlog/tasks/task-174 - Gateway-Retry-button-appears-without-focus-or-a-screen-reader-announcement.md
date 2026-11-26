---
id: TASK-174
title: Gateway Retry button appears without focus or a screen-reader announcement
status: Done
assignee: []
created_date: '2026-11-26T02:39:00Z'
updated_date: '2026-11-26T21:47:00Z'
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

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-11-26T21:47:00Z

---

Shipped in PR #233 (merged 2026-11-26 21:44 UTC, c2df978d). Review PASS; its 3 lows ride the next splash-surface PR (TASK-171) per the lows rule: focus falls to body when Retry hides (candidate: focus the splash container before hiding); UnauthorizedVerdict doc still carries the stale dead-credential-kept-by-cookie parenthetical (post-401 notDead is unreachable now); optional aria-describedby=load-desc on #gatewayRetry to pin announcement order. Also filed TASK-186 (splash switch-accounts affordance is keyboard-unreachable) from the same finding class.

---
<!-- COMMENTS:END -->
