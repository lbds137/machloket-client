---
id: TASK-132
title: 'Light themes: link colour fails AA contrast on the darker panel shade'
status: To Do
assignee: []
created_date: '2026-11-24T16:34:00Z'
labels:
  - accessibility
  - themes
dependencies: []
priority: medium
ordinal: 63920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-19's accessibility check (2026-11-24). themes.css --link against --secondary-bg: WHITE #056cd9 on #e0e0ea = 3.86:1, Light #283c8b on #9397bd = 3.51:1 (AA text needs 4.5:1). On --primary-bg they pass (5.01, 4.61). Dark themes pass (5.0-14.1). Every link drawn on the darker shade in those themes is affected, not one surface. Also: app links are colour-only (style.css a { text-decoration: none }, underline on hover only), so a link in running text is told apart from the text by colour alone; TASK-19 underlines its own source link as a local fix. Theme colours are user-visible: needs Lila's call on the palette change and on underlining links app-wide.
<!-- SECTION:DESCRIPTION:END -->
