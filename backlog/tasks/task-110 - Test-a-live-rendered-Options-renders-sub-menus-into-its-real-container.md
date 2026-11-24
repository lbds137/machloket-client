---
id: TASK-110
title: 'Test: a live rendered Options renders sub-menus into its real container'
status: To Do
assignee: []
created_date: '2026-11-24T03:48:00Z'
labels:
  - tests
dependencies: []
priority: low
ordinal: 41920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
settingsOptionsContainer.test.ts (PR #197) covers unrendered and page-dropped Options, but nothing asserts that a rendered Options whose container is still alive renders addSubForm into that real container rather than the 'detached' placeholder. Add: generateHTML(), then addSubForm(...), and assert the returned live container holds the sub-form. Positive control: forcing liveContainer() to return detached must fail it. From the PR #197 review (low).
<!-- SECTION:DESCRIPTION:END -->
