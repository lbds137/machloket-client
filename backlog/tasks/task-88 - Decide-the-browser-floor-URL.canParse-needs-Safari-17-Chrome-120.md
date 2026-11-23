---
id: TASK-88
title: Decide the browser floor; URL.canParse needs Safari 17 / Chrome 120
status: To Do
assignee: []
created_date: '2026-11-23T03:40:00Z'
labels:
  - compat
dependencies: []
priority: low
ordinal: 19920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-5 (C8) review round 1. URL.canParse appears in 31 non-test call sites (git grep, 2026-11-22), including isPreAuthEndpoint in src/webpage/utils/apiFetch.ts, which every apiFetch call runs. So the app already requires Safari 17+ / Chrome 120+ / Firefox 115+, while apiFetch carries an AbortSignal.any fallback for Safari < 17.4, which implies an older floor. Decide the supported floor. If it is below canParse's, replace canParse with a try/new URL helper app-wide; if not, drop the dead-older-browser comments and fallbacks. TASK-5's registry already avoids canParse.
<!-- SECTION:DESCRIPTION:END -->
