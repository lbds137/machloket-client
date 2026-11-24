---
id: TASK-106
title: >-
  Options: classes added via container.deref() are lost when the parent
  re-renders
status: To Do
assignee: []
created_date: '2026-11-24T02:46:00Z'
labels:
  - settings
  - bug
dependencies: []
priority: low
ordinal: 37920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the TASK-99 PR review (Sonnet, low). role.ts ~320/322 (permGrid, added twice) and user.ts ~224 (expandButtons) add a class to an Options' container through container.deref()?.classList.add(...). Options.generateHTML (settings.ts ~2086) builds a fresh container on every render, so when the parent renders again (e.g. genTop after a sub-menu closes) the class is dropped. Inferred from code reading, not runtime-confirmed: the first render likely keeps it, because addOptions renders the child at once. Fix shape: an Options-level list of container classes that generateHTML applies; route both sites through it and drop the duplicate permGrid line. Red-first: render, re-render the parent, assert the class is still on the live container. Re-grep both sites at unit time.
<!-- SECTION:DESCRIPTION:END -->
