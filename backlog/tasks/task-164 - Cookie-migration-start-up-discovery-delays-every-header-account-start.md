---
id: TASK-164
title: 'Cookie migration: start-up discovery delays every header-account start'
status: Done
assignee: []
created_date: '2026-11-25T22:47:00Z'
updated_date: '2026-11-26T10:29:00Z'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-26 grounding: the cost is one /policies/instance/domains round trip (discoverAuthCookie, src/webpage/utils/utils.ts:1297) awaited before the Localuser on every header-account start (src/webpage/index.ts:127); 5 s is the code cap (AUTH_COOKIE_DISCOVERY_MS), not a measurement. Measured only the fast case: localhost instances A/B, curl, n=5 each, 10-77 ms. It is a RECORDED trade-off: docs/design/token-storage.md:166 (As built, unit 4) and :116 (a deployment that turns cookie mode on migrates at the next start). Backgrounding the exchange is ruled out (it must precede the gateway, index.ts:124). Candidate: await only when the stored authCookie is true or unset; when false, start at once and refresh the flag in the background, so the exchange runs at the following start. Needs Lila: it delays a flip-on instance migration by one start (token stays in storage one session longer).

Shipped in PR #224 (15baae3c), 2026-11-26: a record whose stored authCookie is false starts at once; the flag refreshes behind the start; the background write and the exchange re-check stillHeaderLoggedIn. Review lows carried to the next cookie-area PR (role file). CodeQL #94 (test helper) dismissed by Lila as used in tests.
<!-- SECTION:NOTES:END -->
