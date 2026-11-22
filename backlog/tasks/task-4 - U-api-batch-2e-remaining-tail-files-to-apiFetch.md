---
id: TASK-4
title: 'U-api batch 2e: remaining tail files to apiFetch'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-22T14:58:00Z'
labels:
  - u-api
dependencies: []
priority: medium
ordinal: 130
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final file slice per the batch-2 plan (whatever the base grep still lists as raw fetch outside the migrated files).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2c worker (11-22) found raw fetch still in src/webpage/utils/utils.ts outside pingResponse: ~220 (/auth/logout), ~616, ~684, ~764, ~918, ~939 (as of 2c's tree; re-grep at unit time). Classify each per the batch-2 rules.
<!-- SECTION:NOTES:END -->
