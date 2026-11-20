---
id: TASK-42
title: SW deferral pack (EU family)
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - sw
  - deferred
dependencies: []
ordinal: 630
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Needs the SW harness (service.ts is not importable in a page test) — before any non-default SW mode is offered as default/recommended:
- EU-1 state lost on idle termination; EU-2 respondWith after an await re-sends the request in the dev intercept path; EU-3 CDN cache stores error responses under a query-less key (fix: if (f.ok) before putInCache, service.ts ~284).
- EU-6: SW.postMessage polls forever when registration fails and start() never resolves; SW.checkUpdates never resolves in the default mode (the check-update button hangs).
- "Disabled" behaves like "Enabled" (service.ts:206 checks "false", setMode sends "disabled").
- Dev-server stale code (toPath drops the query; HMR ?t= cached; /files.json falls back to index.html).
- ~61MB precached regardless of mode (emoji fonts + changelog art) — phone data cost.
- HTML precached as /index.html but looked up as ./index; downloadAllFiles does not await cachePath/putInCache; SW.setMode(Unregistered) throws when nothing was registered; service.ts:275/285 executor hangs on failure.
- Decide whether daily phone use runs the dev server or a production build (worker/install/offline behave only on a build).
- npm audit: 2 build-time highs (nanoid, postcss) — trigger: next dependency bump, or at once if the dev server is exposed beyond the LAN.
<!-- SECTION:DESCRIPTION:END -->
