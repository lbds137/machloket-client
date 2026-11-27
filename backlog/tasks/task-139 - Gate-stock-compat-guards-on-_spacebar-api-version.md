---
id: TASK-139
title: Gate stock-compat guards on /_spacebar/api/version
status: Done
assignee:
  - machloket-client
created_date: '2026-11-24T18:24:00Z'
updated_date: '2026-11-27T18:42:00Z'
labels:
  - api
  - compat
dependencies: []
priority: medium
ordinal: 70920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: Deck's client+server coupling survey for Lila, 2026-11-24. The client guesses whether it talks to a stock Spacebar or the fork in several compat guards. Read /_spacebar/api/version once per instance and gate those guards on it instead. Inventory the guards first (grep stock/compat/fallback paths), then fix red-first.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-11-27T18:42:00Z

---

CLOSED OBSOLETE 11-27, premise falsified by live probes (machloket-client session; fork = instance A localhost:3001, stock = api.rory.server.spacebar.chat via spacebar.chat well-known):

1. /_spacebar/api/version is NOT fork-only: stock answers 200 application/json {"implementation":"spacebar-server-ts","version":{"rev":"392ffc7f..."}} and fork A answers the same shape (rev 704e7759f). The route cannot distinguish stock from fork, so version-gating on it cannot implement this task.
2. Inventory found NO stock-vs-fork guesses to gate: gif providers = route probe + availability map (stock: 200 {klipy available:true}; fork A: 200 {} -> klipy fallback, correct both sides); register DOB = /policies/instance/config flag probe (stock carries register_dateOfBirth_required:true too; fork true + minimum 13; the === false hide check is correct on both); nsfw_allowed tri-state = value-shape guard (fork NOT NULL column, stock absence -> gated path, identical behavior); MFA keyFallback (settings.ts:2398) = response-shaped (absent flag = absent feature); authCookie discovery = capability probe with undefined-safe fallback.
3. Greps (stock, _spacebar, capabilities/isFork, guess/assume/older-server, 40001, dob/restrict, cookieModeHosts) over non-test src: no branching on instance identity anywhere. 40001 exists only in a test fixture; the 401 probe is universal and TASK-182 tracks its fork fast path separately.

Residual: a future fork-capability fast path (e.g. TASK-182 40001) cannot read capability from the version rev either; that task keeps its own server-ping trigger. TASK-22 (DOB error wiring) is unaffected: fork-only keys (register_dateOfBirth_minimum) stay its scope.

---
<!-- COMMENTS:END -->
