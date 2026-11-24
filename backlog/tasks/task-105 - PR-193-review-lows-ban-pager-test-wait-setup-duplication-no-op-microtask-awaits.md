---
id: TASK-105
title: >-
  PR #193 review lows: ban-pager test wait, setup duplication, no-op microtask
  awaits
status: To Do
assignee: []
created_date: '2026-11-24T02:07:00Z'
labels:
  - tests
  - bans
dependencies: []
priority: low
ordinal: 36920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the claude-review on PR #193 (TASK-98), all in src/webpage/streamedLists.test.ts. (1) "a ban that arrives after Next fills in under page 2s rows" waits on vi.getTimerCount() growing; if the stream path ever re-arms a faked timer per chunk, frames() spins 300 frames (~5 s) and continues - wait on the observable effect instead (advance 1 ms inside the frame loop until 2 rows show). (2) The three ban-pager tests repeat the 51-ban feed, button lookup and close-then-wait-for-abort tail; a small helper (e.g. openBansWith51 / finishStream) keeps them in step. (3) The await Promise.resolve() after each vi.advanceTimersByTime(1) is a no-op (the draw runs synchronously in the timer callback); drop it. Anchors as of 85315f9e; re-grep.
<!-- SECTION:DESCRIPTION:END -->
