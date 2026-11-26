---
id: TASK-172
title: Dedicated status line while the gateway Retry button shows
status: Done
assignee: []
created_date: '2026-11-26T02:31:00Z'
updated_date: '2026-11-26T20:35:00Z'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Lila 2026-11-26 (AskUserQuestion): two lines. Alive probe: 'The instance refused the connection, but your session is still valid. Retry, or switch accounts if it keeps happening.' Unanswered probe (5xx/429/timeout): 'The instance refused the connection and didn't answer a session check. Retry, or switch accounts if it keeps happening.' Needs probeUnauthorized/gatewayAuthFailed to tell alive from unanswered (both are 'notDead' today).

Carry the PR #231 (TASK-173) review lows into this PR: (1) the gatewayAuthRetried doc should say only a heartbeat ACK held 20 s re-arms the retry (a server that never ACKs gets the Retry button after one retry); (2) name the 20 s threshold (e.g. GOOD_CONNECTION_MS) in endConnectionMeasure and use it in the tests (21_000 / 60_000); (3) e2e/mock readyThenCloses doc: the close depends on every READY sending a fresh GIF-provider request, else the spec times out waiting for #gatewayRetry.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-11-26T20:35:00Z

---

Shipped in PR #232 (merged 2026-11-26 20:31 UTC, c77591b2). Review PASS; its 4 lows (unengaged-probe fallback shows the valid line, invalidate-failure notDead line, qqq note breadth, retry-screen test scaffolding helper) ride TASK-174's PR per the lows rule.

---
<!-- COMMENTS:END -->
