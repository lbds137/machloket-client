---
id: TASK-136
title: 'Token storage design: httpOnly session cookie vs header tokens'
status: To Do
assignee: []
created_date: '2026-11-24T18:11:00Z'
updated_date: '2026-11-24T22:39:00Z'
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

2026-11-24: design agreed with Machloket Server. Client half: docs/design/token-storage.md (PR #211, plus the review follow-up). Server contract merged (server PR #280); server units are its TASK-313, then 321-323. Client implementation sequence is in the doc: unit 1 (one account-keyed request path + 401 handling) and unit 2 (TASK-145) need no server work; units 3-5 wait on the server units. TASK-147 (gateway 4004) can land on its own.

PR #212 review (PASS, 2026-11-24) left 5 low items on docs/design/token-storage.md; deferred to design unit 1 (trigger: unit 1 starts; fix the doc in that PR): (1) the preflight sentence: builder GETs already carry JSON Content-type, so the marker adds a preflight only to FormData sends; (2) decide whether the marker->credentials rule gets a host condition (marker AND cookie-mode host or the in-flight login discovery host), or pin with a test that builder output only goes to info.api URLs; (3) reword the hazard section opener as today's wrapper, not the target; (4) one phrase for the three CSRF-checked GETs (contract vs residual-risk bullet); (5) say when the stored authCookie flag is refreshed (each start's discovery vs login only).
<!-- SECTION:NOTES:END -->
