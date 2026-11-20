---
id: TASK-69
title: MarkDown render O(n^2) on plain text
status: To Do
assignee: []
created_date: '2026-11-19T22:21:00Z'
updated_date: '2026-11-20T02:39:00Z'
labels:
  - render
  - deferred
dependencies: []
priority: low
ordinal: 920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Measured O(n^2) on long plain text (filed 11-08; the exact site unprofiled). No fix scheduled — profile first (plain render is itself quadratic, so the scaling-test fallback was ruled out). Trigger: a slow-render report or the next markdown perf touch.
<!-- SECTION:DESCRIPTION:END -->
