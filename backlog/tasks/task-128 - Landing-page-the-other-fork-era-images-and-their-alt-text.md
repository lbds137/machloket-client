---
id: TASK-128
title: 'Landing page: the other fork-era images and their alt text'
status: To Do
assignee: []
created_date: '2026-11-24T16:08:00Z'
labels:
  - branding
  - a11y
dependencies: []
priority: low
ordinal: 59920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-19 replaced the one image the 11-10 ruling named (the settings shot, src/webpage/index.html:93). The rest of the landing art still shows Fermo-era UI: the three hero screenshots (index.html:60-62, home/SS1-3.webp) and the feature images features/spacebar-explorer-int.webp (index.html:80) and features/mobile-view.webp (index.html:116). Their alt text says only 'Screenshot 1' / 'Feature 1', which tells a screen-reader user nothing. Capture replacements through e2e/ux-shots.spec.ts (the 'landing' block shows the pattern), describe each in its alt, and check the explorer feature box still matches the client (the bot catalog left in TASK-18). Her eyes on the final shots.
<!-- SECTION:DESCRIPTION:END -->
