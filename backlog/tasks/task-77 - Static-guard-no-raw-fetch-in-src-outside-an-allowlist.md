---
id: TASK-77
title: 'Static guard: no raw fetch( in src outside an allowlist'
status: To Do
assignee: []
created_date: '2026-11-22T20:53:00Z'
labels:
  - u-api
dependencies: []
priority: medium
ordinal: 8920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From PR #172 claude-review Low (TASK-3). Most U-api swaps are pinned only by the inventory grep; a later rewrap could regress one to raw fetch unseen, and TASK-3's own line-level grep hid a raw fetch sharing a line with fetchRetryOnce (message.ts:163). Add a unit test that scans src/**/*.ts (non-test) for raw fetch( via a lookbehind like (?<![A-Za-z_.])fetch\( and fails on any hit outside an explicit allowlist with a reason per entry (apiFetch.ts internals, /getupdates, CDN/asset leaves, service worker). Sequence AFTER TASK-4 (2e tail) so the allowlist is final, or land it with 2e.
<!-- SECTION:DESCRIPTION:END -->
