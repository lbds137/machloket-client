---
id: TASK-58
title: CI/perf routine units (measured 11-10)
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-27T08:28:00Z'
labels:
  - tooling
  - e2e
  - deferred
dependencies: []
priority: medium
ordinal: 810
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Config-only units; prove each with a CI timing on its PR (no red-first for config):
- Unit A: CI e2e workers process.env.CI ? 2 : 1 (playwright.config.ts:25; est. 417s -> ~210s) + cache the Playwright browsers dir in CI (~13s/job) + concurrency cancel-in-progress (check first that automerge does not need the cancelled run's status) + build-twice tidy (<=2s).
- Unit D: make the pingGuard test budget overridable (utils.ts pingTimeoutMs + pingGuard.test.ts; file 30s -> ~1.5s).
- F5: vitest maxWorkers 3 locally (peak RSS 2.3GB -> ~1.2GB inferred; measure before/after).
- Unit B (measure A first; may not pay for itself): split CI into a unit job + 2 e2e shards.
- Unit C (medium risk): login once + storageState + deep links instead of UI login per test; keep app-boot/login-layer/smoke/harness/full-storage-boot on UI login.

Known and accepted: the backlog.md devDependency adds one platform binary to every npm ci (CI included, CLI never run there) — exact pin kept for store-layout integrity; revisit here if install time ever registers.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: machloket-client
created: 2026-11-27T08:28:00Z

---

Unit D landed 11-27 in PR #238 (merged 26fc5715, three main commits): injectable ping budget param (pingResponse/pingOK/checkURLs, default still pingTimeoutMs 10s so prod paths unchanged), hang pins 10s to 0.1s budget with races at BUDGET+2000, HANG_IT timeout 30s to 5s. Measured: pingGuard file 30.2s to 0.53s summed (5 tests); rateLimit two Retry-After header tests "1" to "0.5" (~1s to ~0.55s each, 300ms settle kept strictly inside the 500ms window; the retry_after 0.3 cancellation family deliberately untouched). Review: agy gemini PASS zero deviations; claude-review PASS 8530fb62 with three lows carried (carried-lows.md #238). Baseline floors 11-27 (suite-time log): format 29.8 / check 2.1 / vitest 145.6 / build 4.9 / check:e2e 5.4 / e2e 705.0s serial (workers=1 swap-stall ruling playwright.config.ts:22-25; summed 691 of 705 = serial floor). The e2e floor is Unit C work; A/B/F5 remain as filed.

---
<!-- COMMENTS:END -->
