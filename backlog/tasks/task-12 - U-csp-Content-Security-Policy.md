---
id: TASK-12
title: 'U-csp: Content-Security-Policy'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - tooling
dependencies: []
priority: low
ordinal: 240
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
R9 LOW hardening: no CSP anywhere. Feasible starting point: script-src 'self', object-src 'none', base-uri 'none', frame-src youtube. Needs a sweep of every inline script/style first (the app builds inline SVG/styles).
<!-- SECTION:DESCRIPTION:END -->
