---
id: TASK-72
title: 'Streamed guild lists: failure state + budget (2c review follow-ups)'
status: To Do
assignee: []
created_date: '2026-11-22T15:27:00Z'
updated_date: '2026-11-22T16:42:00Z'
labels:
  - u-api
dependencies: []
priority: high
ordinal: 3920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From PR #168 claude-review (merged 0d63c6db). (a) makeInviteMenu and the ban menu loops ('while (!(await bansp).done)' in src/webpage/guild.ts) throw inside an un-awaited async builder when ProgessiveDecodeJSON rejects (timeout, non-ok, 401): unhandled rejection, half-rendered list, no message. Catch and show a refusal/offline line; red-first. (b) The lists share one 30 s apiFetch budget for headers + whole body, and the loops build cards while reading, so a large ban list on a slow link can be cut mid-list (correction to the PR #168 body, which said only a stalled server would hit it). Decide: larger timeoutMs for the two lists, or a per-chunk idle timeout. (c) Pins owed: the sticker POST keeps timeoutMs: 0; the fallback listener pair is removed after the timeout fires. (d) Nit: ProgressiveArray's default fetcher as an explicit wrapper ((input, init) => fetch(input, init)). Trigger: next unit.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision (b): per-wait idle budget (30 s on the headers and each body chunk; reader time between reads not counted) via ProgressiveArray's opt-in idleTimeoutMs, lists pass timeoutMs: 0 to apiFetch. A larger fixed budget only moves the mid-list cut. In PR #169; follow-up TASK-73.
<!-- SECTION:NOTES:END -->
