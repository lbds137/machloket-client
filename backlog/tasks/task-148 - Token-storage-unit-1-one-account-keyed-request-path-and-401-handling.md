---
id: TASK-148
title: 'Token storage unit 1: one account-keyed request path and 401 handling'
status: To Do
assignee: []
created_date: '2026-11-24T22:40:00Z'
labels:
  - security-hardening
  - auth
dependencies: []
documentation:
  - docs/design/token-storage.md
priority: high
ordinal: 79920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-136 design unit 1 (docs/design/token-storage.md, Sequence 1 and "One account-keyed request path", "The ambient-cookie hazard", "401 handling"). Needs no server work. One builder for every account request (Localuser.headers mutated in place), requests tagged with their account so handleUnauthorized/invalidateAccount key by uid, raw-token pages (bot invite, invite acceptance, template joining, logout, 401 probe) take the account, bots stay outside, the global wrapper adds credentials only to requests carrying the CSRF marker. Header accounts behave as today; this is the groundwork every later unit builds on. Also fix in this PR the 5 doc leftovers from the PR #212 review recorded on TASK-136. Tests per the doc's Tests list.
<!-- SECTION:DESCRIPTION:END -->
