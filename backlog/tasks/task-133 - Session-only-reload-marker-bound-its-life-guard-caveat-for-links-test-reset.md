---
id: TASK-133
title: 'Session-only reload marker: bound its life; guard caveat for links; test reset'
status: To Do
assignee: []
created_date: '2026-11-24T17:48:00Z'
labels:
  - session-accounts
  - test-robustness
dependencies: []
priority: low
ordinal: 64920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #208 (TASK-6) claude-review lows, non-blocking, filed rather than a fourth PR (Lila 11-24: finish the highs, then park). 1) machloket.appReload (src/webpage/utils/storage/settingOverlay.ts APP_RELOAD_KEY, set by pageNav.reload in utils/netUtils.ts) is cleared only by a page that evaluates settingOverlay.ts; a reload served by a page that never imports it leaves the marker, and a later USER reload of that exact URL keeps the hand-off once. Fix: timestamp the marker (short TTL) or also clear it on the 404 path; red-first. 2) navigationGuard.test.ts header: say <a href> and window.open same-origin navigations rely on the hand-off still being unconsumed (no carry). 3) sessionOnlyNavigation.test.ts reset() should clear APP_RELOAD_KEY. Re-grep the named files at unit time.
<!-- SECTION:DESCRIPTION:END -->
