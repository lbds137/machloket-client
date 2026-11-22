---
id: TASK-4
title: 'U-api batch 2e: remaining tail files to apiFetch'
status: In Progress
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-22T21:39:00Z'
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

11-22: spec at docs/local/u-api-b2e-spec.md (base ee842e80). Decisions: discovery keeps redirects (spacebar.chat .well-known 301s) via a timeout-only helper; instances.json raw (module-scope import cycle); /auth/logout exempted from 401 routing; profileSave/dataExport timeoutMs 0.

11-22: PR #173 (9d7350c7) open; gate + e2e green; council (OpenAI) review dispositioned in the PR body; follow-ups (j)-(l) in TASK-2.
<!-- SECTION:NOTES:END -->
