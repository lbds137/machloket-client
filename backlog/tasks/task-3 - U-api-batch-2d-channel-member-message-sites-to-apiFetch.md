---
id: TASK-3
title: 'U-api batch 2d: channel/member/message sites to apiFetch'
status: Done
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-22T20:53:00Z'
labels:
  - u-api
dependencies: []
priority: medium
ordinal: 70
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Next slice per the batch-2 plan. Rider: `src/webpage/message.ts:2500` inline status-only Dialog gets the server-reason treatment in the same unit.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped PR #172 -> 3e588e6f (2026-11-22): 27 sites to apiFetch (channel 16, member 7, message 4 incl. fetchReactionUsers retry:false found by the Gemini cross-family pre-PR review), sendForward -> showRefusal, 7 red-first rows. claude-review PASS; its Low -> static raw-fetch guard task. Dead highInfo/addRoleToPerms -> TASK-76.
<!-- SECTION:NOTES:END -->
