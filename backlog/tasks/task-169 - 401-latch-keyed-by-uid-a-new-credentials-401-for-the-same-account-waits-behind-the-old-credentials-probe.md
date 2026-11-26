---
id: TASK-169
title: >-
  401 latch keyed by uid: a new credential's 401 for the same account waits
  behind the old credential's probe
status: To Do
assignee: []
created_date: '2026-11-26T01:01:00Z'
updated_date: '2026-11-26T02:13:00Z'
labels:
  - auth
  - bug
dependencies: []
priority: low
ordinal: 100920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the council (gpt-5.5) review of TASK-156 (code-reading; not runtime-confirmed). The 401 latch in src/webpage/utils/apiFetch.ts (unauthorizedPending) is keyed by account uid. If the same uid gets a new credential in-page (a re-login through the switcher, or a cookie conversion) while the old credential's probe is out, the new credential's 401 or gateway 4004 returns early; the old probe's dead verdict then fails invalidateAccount's credential match (TASK-153) and releases the latch, so the new credential's 401 is never probed. Invalidation itself is safe (credential-matched). First decide reachability (can a same-uid credential change happen in-page while a probe is out?); if reachable, key the latch by uid + credential and keep one /login navigation per page.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-25 (TASK-157 council review, gpt-6.2-sol): since TASK-157 the gateway's 4004 path ACTS on the latch's verdict (probeUnauthorized returns the held run's promise), so a held run for an older credential now also hands its verdict to a newer credential's 4004. Checked safe by reading (not runtime-confirmed): notDead costs one bounded IDENTIFY retry with the current credential; adopted changes the token, so gatewayAuthFailed's token check reconnects first. Keying the latch by uid + credential fixes both.
<!-- SECTION:NOTES:END -->
