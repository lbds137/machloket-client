---
id: TASK-80
title: 'createImg: a fallback setSrcs can lose a race to a newer source'
status: To Do
assignee: []
created_date: '2026-11-22T23:45:00Z'
labels:
  - media
dependencies: []
priority: low
ordinal: 11920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the PR #174 claude-review (round 1, low) and the council review. setSrcs assigns img.src asynchronously, after isAnimated() resolves (src/webpage/utils/utils.ts, createImg). If the global avatar's 'error' fires after buildpfp's setSrcs(member avatar) call but before that call lands, the TASK-78 fallback's setSrcs(default) overwrites the closure src. Whichever promise resolves last wins, so a valid member avatar can lose to the default avatar, and the hover handler then restores the default. Rare and cosmetic. Not fixed in #174 because the fix changes an async boundary (ask-class). Do: give createImg a source revision counter so only the latest setSrcs can assign img.src, and route the avatar fallback through it. Red-first with a deferred isAnimated stub.
<!-- SECTION:DESCRIPTION:END -->
