---
id: TASK-55
title: Console residue sweep
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:39:00Z'
labels:
  - deferred
  - cleanup
dependencies: []
priority: low
ordinal: 760
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Debug console sites to delete on the next touch of each file (numbers drift — grep console. in the named file at touch time): infiniteScroller.ts ~127; message.ts ~809 + ~1065; guild.ts discovery ~125, sortPerms ~748/757 x2, generateSettings ~666/~707; localuser.ts console.warn ~2167/~2178 + console.log ~2245; settings.ts ~1893; reporting/report.ts ~319/~358; bot.ts:275; utils.ts setTheme log ~:37.
<!-- SECTION:DESCRIPTION:END -->
