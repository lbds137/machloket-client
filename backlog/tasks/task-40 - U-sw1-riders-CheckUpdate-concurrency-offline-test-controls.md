---
id: TASK-40
title: 'U-sw1 riders: CheckUpdate concurrency + offline test controls'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - sw
  - deferred
dependencies: []
priority: low
ordinal: 610
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
(a) A port CheckUpdate clears checkedrecently and can start a second concurrent check while a getfile-driven one is mid-download — share one in-flight promise in checkCache. Trigger: next checkCache/CheckUpdate touch.
(b) Offline-window/registerSuccess/fallback tests need a same-origin network-failure control (the middleware would need a generic path override — production edit is its own decision).
(c) Pins owed: marker-after-download ordering + no-ports tryToClose (need a hanging-/files.json control) — fold into the next service.test.ts touch.
(d) Cosmetic: the buildRevisionPlugin transform returns no sourcemap (rollup warning) — fix only if it gets noisy.
<!-- SECTION:DESCRIPTION:END -->
