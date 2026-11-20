---
id: TASK-51
title: guild.apps set per getCommands call
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - deferred
dependencies: []
ordinal: 720
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
guild.apps is set per getCommands call, so two DM lists asked back-to-back can show one render with the other DM's app icons (narrow, old shape). Fix: return apps with the commands from a findCommands-facing accessor. Trigger: any wrong-icon report, or the next findCommands touch.
<!-- SECTION:DESCRIPTION:END -->
