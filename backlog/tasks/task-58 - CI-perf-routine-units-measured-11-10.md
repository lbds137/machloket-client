---
id: TASK-58
title: CI/perf routine units (measured 11-10)
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
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
