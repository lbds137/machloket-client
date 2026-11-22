---
id: TASK-73
title: 'Streamed lists: a non-array payload reads as offline'
status: To Do
assignee: []
created_date: '2026-11-22T16:41:00Z'
labels:
  - u-api
dependencies: []
priority: low
ordinal: 4920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the PR #169 council review (TASK-72). streamList (src/webpage/guild.ts) casts ProgessiveDecodeJSON's result to an array decoder; a 200 whose body is a JSON object or scalar fails on arr.getNext and the list shows requestFailed("offline"), which misnames a protocol error. Check the top-level decoder type and show a distinct line (needs an I18n string). Trigger: next touch of the invite/ban lists, or any report of an "offline" list on a live link.
<!-- SECTION:DESCRIPTION:END -->
