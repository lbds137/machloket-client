---
id: TASK-14
title: 'U-sw2: service-worker storage growth'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - sw
dependencies: []
ordinal: 260
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
P6 MED perf/growth (inherited): `src/webpage/service.ts` — swStorage URL map unbounded, re-stringified + cache.put per CDN hit (:93-109, :64-67); cacheSize clones every blob at start (:45-85); clearCdnCache leaves keys (:447). Fix: debounce save, delete keys on evict/clear, size via Content-Length. Shares the SW-harness trigger with the other service.ts units.
<!-- SECTION:DESCRIPTION:END -->
