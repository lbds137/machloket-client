---
id: TASK-171
title: >-
  Loading splash text is unreadable in light themes (brand-dark background,
  theme-coloured text)
status: To Do
assignee: []
created_date: '2026-11-26T02:13:00Z'
labels:
  - accessibility
  - bug
dependencies: []
priority: medium
ordinal: 102920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-157's accessibility pass (screenshot evidence, Light-theme class on the retry screen; contrast not yet measured per theme). #loading pins its background to var(--brand-bg) (#0b0b12) with !important in every theme (src/webpage/public/style.css, the #loading rule), while #load-desc and #switchaccounts take the theme's --loading-text / --link. In Light (and likely WHITE) the status text and the Switch accounts link nearly vanish on the dark splash. Fix: give the splash its own text and link colours tied to the brand background (as the TASK-157 Retry button's border does), then measure AA for every theme.
<!-- SECTION:DESCRIPTION:END -->
