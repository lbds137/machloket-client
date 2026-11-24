---
id: TASK-135
title: Strict CSP + Trusted Types via a Pages _headers file
status: Done
assignee: []
created_date: '2026-11-24T18:11:00Z'
updated_date: '2026-11-24T20:45:00Z'
labels:
  - security-hardening
  - deploy
dependencies: []
priority: high
ordinal: 66920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hardening (Lila via Deck 11-24). The client ships as a static Cloudflare Pages site (wrangler.json) with no _headers file and no CSP in src (Deck's check at 3c5d22e5). Add a _headers file with a strict Content-Security-Policy: script-src 'self' with no inline script is the part that matters; connect-src must allow the user-configured instances (api, cdn, gateway ws/wss), and img/media sources likewise. Add Trusted Types (require-trusted-types-for 'script') once the innerHTML sinks are routed through a policy. Inventory inline scripts/styles and eval-like uses first; verify in the e2e harness (headers served by preview). Pairs with the token-storage design task.
<!-- SECTION:DESCRIPTION:END -->
