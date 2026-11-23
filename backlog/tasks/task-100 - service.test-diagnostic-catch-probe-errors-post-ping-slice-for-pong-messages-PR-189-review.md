---
id: TASK-100
title: >-
  service.test diagnostic: catch probe errors, post-ping slice for pong +
  messages (PR #189 review)
status: To Do
assignee: []
created_date: '2026-11-23T21:37:00Z'
labels:
  - tests
dependencies: []
priority: low
ordinal: 31920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #189's claude-review (VERDICT PASS on e70986c4, merged) left three low findings on the TASK-71 diagnostic in `src/webpage/service.test.ts`. Each one can blur the evidence the diagnostic exists to collect:

1. A `diagnose()` that rejects (e.g. `caches.open` failing in `markerText()` under load) replaces the `timed out waiting for …` error. Catch it so both survive: `; diagnose failed: <e>`.
2. "messages after" prints the full `messages` list, so pre-ping messages repeat there. Slice from the pre-ping length.
3. The pong check `messages.some((m) => m.code === "pong")` could match a pong older than this ping. Match only entries after the pre-ping length (the same slice as 2).

Test-only; red-first is not applicable (diagnostic wording). Positive control: rerun the CheckUpdate-postMessage-removed copy and quote the line.
<!-- SECTION:DESCRIPTION:END -->
