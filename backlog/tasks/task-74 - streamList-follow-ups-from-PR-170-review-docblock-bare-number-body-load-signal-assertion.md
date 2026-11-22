---
id: TASK-74
title: >-
  streamList follow-ups from PR #170 review: docblock, bare-number body,
  load-signal assertion
status: Done
assignee: []
created_date: '2026-11-22T17:41:00Z'
updated_date: '2026-11-22T19:26:00Z'
labels:
  - u-api
dependencies: []
priority: medium
ordinal: 5920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From PR #170 claude-review (TASK-73, merged f7b182d1). (1) identifyType's docblock in src/webpage/utils/progessiveLoad.ts overclaims 'every malformed-body error is a SyntaxError': the number branch returns Number(build), so 1-2 / 1e decode to NaN silently; make NaN throw SyntaxError (red-first) and reword to 'malformed token; a body that ends early reads as a dead load'. (2) a 200 whose body is exactly 5 (no trailing whitespace) reads past EOF -> 'ran out of file to read' -> offline, while 5\n reads unreadable; pin it with a test, then decide (fix or document). (3) the callback-throw test in src/webpage/streamedLists.test.ts spies AbortController.prototype.abort (any controller); assert the load's own signal instead (handFed signals, or a fetcher-level signal capture). Trigger: next bounded agy-worker unit (fits the 13:22 agy lane).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #171 (3 commits: a9a37c3b A items 1,2,3,5; 89163024 B item 4 lazy delimiter; 8ce679e3 review nit). Gemini PASS (1 nit fixed); claude-review PASS with 2 Lows -> TASK-75.
<!-- SECTION:NOTES:END -->
