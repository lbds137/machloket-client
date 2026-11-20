---
id: TASK-1
title: 'U-api batch 2c: guild.ts + role.ts + emoji.ts raw-fetch to apiFetch'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - u-api
dependencies: []
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Next U-api unit per the batch-2 plan (local doc `docs/local/u-api-b2-plan.md`): ~30 sites (guild.ts 24, role.ts 3, emoji.ts 3). Same flow as batch 2b: inventory grep at base, per-site classification (plain-awaited / .then-chains / fetchWithMfa inner / token-less pre-auth-exempt), spec with premise ledger, fresh-context worker, driver verify, PR.

Fold in here: the two raw-fetch AbortController users `src/webpage/utils/progessiveLoad.ts` and `pingResponse` — when they migrate, re-check the signal-passing caveat documented at `src/webpage/utils/apiFetch.ts` (on the no-AbortSignal.any fallback, forwarded listeners come off at fetch settle).
<!-- SECTION:DESCRIPTION:END -->
