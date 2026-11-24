---
id: TASK-141
title: >-
  e2e-real mfa-challenge: mint the bot before enabling TOTP (server now asks for
  MFA there)
status: To Do
assignee: []
created_date: '2026-11-24T20:03:00Z'
labels:
  - e2e-real
dependencies: []
priority: medium
ordinal: 72920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
e2e-real/mfa-challenge.spec.ts setup calls POST /applications/:id/bot AFTER enableTotp(owner); since server commit 6234d53aa (2026-11-11) minting a bot token for an MFA owner requires X-Discord-MFA-Authorization (requireApplicationMfa, server src/api/util/handlers/ApplicationAccess.ts), so the setup gets 400 code 60003 and the spec fails before its first assertion (seen 2026-11-24 in the TASK-135 real-tier run; also fails on main's client). Intended server behaviour (Machloket Server session, 11-24). Fix: create both applications and mint the kept app's bot before enableTotp, then run the real tier once to see it green. Re-grep line numbers at unit time.
<!-- SECTION:DESCRIPTION:END -->
