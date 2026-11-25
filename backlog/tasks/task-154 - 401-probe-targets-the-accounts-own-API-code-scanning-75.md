---
id: TASK-154
title: '401 probe targets the account''s own API (code-scanning #75)'
status: Done
assignee: []
created_date: '2026-11-25T17:58:00Z'
updated_date: '2026-11-25T18:40:00Z'
labels:
  - security-hardening
  - auth
dependencies: []
priority: high
ordinal: 85920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CodeQL js/request-forgery (critical) at src/webpage/utils/apiFetch.ts:51: tokenIsDead builds the probe URL from the 401'd request's origin and sends the account's current credential there. Fix: probe the account's own serverurls.api; engage only when the 401 came from that API origin.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #214; CodeQL on main c60a8e63 marked code-scanning #75 fixed (2026-11-25T18:39:48Z).
<!-- SECTION:NOTES:END -->
