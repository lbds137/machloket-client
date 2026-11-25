---
id: TASK-158
title: 'Cookie login: WebAuthn MFA step test for the opt-in headers'
status: To Do
assignee: []
created_date: '2026-11-25T20:24:00Z'
updated_date: '2026-11-25T21:41:00Z'
labels:
  - testing
  - auth
dependencies: []
priority: low
ordinal: 89920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-149 review: the opt-in and CSRF headers are spread into both MFA steps (settings.ts handle2fa), but only the TOTP step is tested; docs/design/token-storage.md's mock-e2e list names both MFA steps. Add a unit test for the WebAuthn step and an e2e MFA case.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-11-25T21:10:00Z

---

PR #216 review: also add an MFA case to the mock e2e (e2e/cookie-login.spec.ts), or narrow docs/design/token-storage.md's Mock e2e list ('on both MFA steps') to what exists.

---
<!-- COMMENTS:END -->
